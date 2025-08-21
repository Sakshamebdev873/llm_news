const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const { Chroma } = require("@langchain/community/vectorstores/chroma");
const { pipeline } = require('@xenova/transformers');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
require('dotenv').config();

// Custom embeddings class for Sentence Transformers
class SentenceTransformerEmbeddings {
  constructor(modelName) {
    this.modelName = modelName;
    this.pipeline = null;
  }

  async load() {
    try {
      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        quantized: false,
        local_files_only: false,
        cache_dir: './model_cache'
      });
      console.log('Loaded non-quantized ONNX model');
    } catch (error) {
      console.error('Error loading ONNX model, trying PyTorch fallback:', error);
      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        framework: 'pt',
        local_files_only: false,
        cache_dir: './model_cache'
      });
      console.log('Loaded PyTorch model');
    }
  }

  async embedDocuments(texts) {
    if (!this.pipeline) await this.load();
    return Promise.all(texts.map(t => this.embedQuery(t)));
  }

  async embedQuery(text) {
    if (!this.pipeline) await this.load();
    const result = await this.pipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  }
}

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/newsdb').then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongo schema for query logs
const QuerySchema = new mongoose.Schema({
  question: String,
  response: Array,
  summary: String,
  date: { type: Date, default: Date.now }
});
const QueryLog = mongoose.model('QueryLog', QuerySchema);

// Embeddings model
const modelName = 'sentence-transformers/paraphrase-MiniLM-L3-v2';
const embeddings = new SentenceTransformerEmbeddings(modelName);

// Initialize Chroma vector store (but we'll create it dynamically in the endpoint)
let vectorStore = null;

// Gemini-1.5-Flash for summarization
const geminiModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.5,
  maxOutputTokens: 150
});

// Summarize articles
async function summarizeArticles(articles) {
  if (!articles.length) return "No articles found to summarize.";
  const combinedText = articles.map(doc => `${doc.metadata.headline}: ${doc.pageContent}`).join('\n');
  const prompt = `Summarize the following football news articles in 2-3 sentences:\n${combinedText}`;
  try {
    const response = await geminiModel.invoke(prompt);
    return response.content;
  } catch (error) {
    console.error('Summarization error:', error);
    return "Failed to generate summary.";
  }
}

app.post('/api/v1/query', async (req, res) => {
  const { question } = req.body;
  
  if (!question) {
    return res.status(400).json({ error: "Question is required" });
  }

  try {
    const lowerQuestion = question.toLowerCase();
    const today = new Date().toISOString().split('T')[0];

    console.log("=== QUERY PROCESSING ===");
    console.log("Question:", question);

    // Initialize Chroma vector store dynamically
    if (!vectorStore) {
      vectorStore = new Chroma(embeddings, {
        collectionName: "news_articles",
        url: "http://localhost:8000",
      });
      console.log("Chroma vector store initialized");
    }

    // Ask Gemini to classify the category
    const categoryPrompt = `Identify the category of this news query in ONE word (like sports, crime, politics, tech, business, etc). No other text. Query: "${lowerQuestion}"`;
    
    let category = '';
    try {
      const gemini_response = await geminiModel.invoke(categoryPrompt);
      
      if (typeof gemini_response === "string") {
        category = gemini_response.trim().toLowerCase();
      } else if (gemini_response?.content) {
        category = gemini_response.content.toString().trim().toLowerCase();
      }
      
      console.log("Detected category:", category);
    } catch (error) {
      console.error("Gemini category detection failed:", error);
      category = ''; // Continue without category filter
    }

    // Build filter for Chroma
    let filter = undefined;
    if (category && category.length > 2) {
      filter = { 
        "categories": { 
          "$eq": category 
        } 
      };
      console.log("Applying filter:", filter);
    }

    // Query Chroma vector store
    let results = [];
    try {
      // Try with filter if available
      if (filter) {
        results = await vectorStore.similaritySearch(question, 20, filter);
        console.log("Results with category filter:", results.length);
      }

      // If no results with filter, try without filter
      if (results.length === 0) {
        results = await vectorStore.similaritySearch(question, 20);
        console.log("Results without filter:", results.length);
        
        // Manually apply category filter if needed
        if (category && results.length > 0) {
          results = results.filter(doc => 
            doc.metadata.categories && 
            doc.metadata.categories.toLowerCase() === category.toLowerCase()
          );
          console.log("Results after manual category filter:", results.length);
        }
      }
    } catch (error) {
      console.error("Chroma query error:", error);
      return res.status(500).json({ error: "Failed to query database" });
    }

    // Apply date filtering if query mentions "today"
    let filteredResults = results;
    if (lowerQuestion.includes("today") && filteredResults.length > 0) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(
        (doc) => doc.metadata.scraped_at && doc.metadata.scraped_at.startsWith(today)
      );
      console.log(`Date filtering: ${beforeCount} -> ${filteredResults.length} results`);
    }

    // Limit to top 5 results
    filteredResults = filteredResults.slice(0, 5);
    console.log("Final results count:", filteredResults.length);

    // Prepare response
    const response = filteredResults.map((doc) => ({
      headline: doc.metadata.headline || "No headline",
      description: doc.pageContent || "No description",
      source: doc.metadata.source || "Unknown source",
      categories: doc.metadata.categories || "general",
      scraped_at: doc.metadata.scraped_at || "Unknown date",
    }));

    // Summarize
    let summary = "No articles found to summarize.";
    if (filteredResults.length > 0) {
      summary = await summarizeArticles(filteredResults);
    }

    // Save query log
    try {
      await new QueryLog({ question, response, summary }).save();
      console.log("Query logged successfully");
    } catch (logError) {
      console.error("Failed to save query log:", logError);
    }

    console.log("=== QUERY COMPLETE ===");

    res.json({ 
      results: response, 
      summary,
      detected_category: category,
      total_results: filteredResults.length
    });

  } catch (error) {
    console.error("Error processing query:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// HEALTH CHECK ENDPOINT
app.get('/api/v1/health', async (req, res) => {
  try {
    // Test Chroma connection
    const testStore = new Chroma(embeddings, {
      collectionName: "news_articles",
      url: "http://localhost:8000",
    });
    
    const testResults = await testStore.similaritySearch("test", 1);
    
    res.json({ 
      status: "healthy", 
      chroma_connected: true,
      documents_available: testResults.length > 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: "unhealthy", 
      chroma_connected: false,
      error: error.message 
    });
  }
});

// DEBUG ENDPOINT - Check collection contents
app.get('/api/v1/debug/collection', async (req, res) => {
  try {
    const debugStore = new Chroma(embeddings, {
      collectionName: "news_articles",
      url: "http://localhost:8000",
    });

    // Get some sample documents
    const sampleResults = await debugStore.similaritySearch("", 5);
    
    const sampleData = sampleResults.map(doc => ({
      headline: doc.metadata.headline || "No headline",
      categories: doc.metadata.categories || "general",
      source: doc.metadata.source || "Unknown source",
      scraped_at: doc.metadata.scraped_at || "Unknown date",
      content_preview: doc.pageContent ? doc.pageContent.substring(0, 100) + '...' : "No content"
    }));

    // Get all unique categories
    const allCategories = new Set();
    sampleResults?.forEach(doc => {
      if (doc.metadata.categories) {
        allCategories.add(doc.metadata.categories.toLowerCase());
      } else {
        console.warn("No categories found for document:", doc.metadata.headline);
      }
    });

    res.json({
      total_sample_docs: sampleResults.length,
      sample_documents: sampleData,
      unique_categories: Array.from(allCategories),
      collection_info: "news_articles"
    });

  } catch (error) {
    console.error("Debug endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5100;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`Debug endpoint: http://localhost:${PORT}/api/v1/debug/collection`);
});
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

// Chroma vector store with updated configuration
const vectorStore = new Chroma(embeddings, {
  collectionName: "news_articles",
  url: "http://localhost:8000",
  embeddingFunction: embeddings // Explicitly set embedding function
});

// Gemini-1.5-Flash for summarization
const geminiModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash",
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

// API endpoint for queries
app.post('/api/v1/query', async (req, res) => {
  const { question } = req.body;
  try {
    const lowerQuestion = question.toLowerCase();
    const today = new Date().toISOString().split('T')[0]; // e.g., "2025-08-20"
    if (lowerQuestion.includes('football news') && lowerQuestion.includes("today")) {
      // Filter by sports category only, fetch more results to allow post-filtering
      const filter = { categories: { $eq: "sports" } };
      const results = await vectorStore.similaritySearch("football news", 10, filter);
      // Post-filter for today's date
      const filteredResults = results.filter(doc => doc.metadata.scraped_at.startsWith(today)).slice(0, 5);
      const response = filteredResults.map(doc => ({
        headline: doc.metadata.headline,
        description: doc.pageContent,
        source: doc.metadata.source,
        categories: doc.metadata.categories,
        scraped_at: doc.metadata.scraped_at
      }));
      const summary = await summarizeArticles(filteredResults);
      await new QueryLog({ question, response, summary }).save();
      res.json({ results: response, summary });
    } else {
      res.json({ results: [], summary: "", message: "Query not supported. Ask about today's football news." });
    }
  } catch (error) {
    console.error('Error processing query:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 5100;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
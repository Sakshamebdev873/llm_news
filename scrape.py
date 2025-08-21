from bs4 import BeautifulSoup
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright
import chromadb
from sentence_transformers import SentenceTransformer
from transformers import pipeline
from datetime import datetime
import hashlib
import json
import torch
import logging
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EfficientNewsScraper:
    def __init__(self):
        # Initialize with CPU-only mode
        self.device = "cpu"  # Force CPU usage
        
        # Initialize ChromaDB
        self.client = chromadb.PersistentClient(path="./news_chroma_db")
        
        # Create collection
        self.collection = self.client.get_or_create_collection(
            name="news_articles",
            metadata={"hnsw:space": "cosine"}
        )
        
        # Migrate existing categories to new format
        self.migrate_categories()
        
        # Use ultra-lightweight embedding model
        self.embedding_model = SentenceTransformer(
            'sentence-transformers/paraphrase-MiniLM-L3-v2',
            device=self.device
        )
        
        # Use distilled categorization model
        self.categorizer = pipeline(
            "zero-shot-classification",
            model="typeform/distilbert-base-uncased-mnli",
            device=-1,  # Force CPU
            framework="pt"
        )
        
        # Website configurations with class-based selectors
        self.websites = {
            "bbc_live": {
                "url": "https://www.bbc.com/live",
                "selectors": {
                    "container": '.sc-225578b-0.btdqbl',
                    "headline": '.sc-88db9cf0-13.juUQAL',
                    "description": '.sc-88db9cf0-14.bWanPM',
                    "link": '.sc-8a623a54-0.hMvGwj',
                    "image": '.sc-d1200759-0.dvfjxj'
                },
                "limit": 12
            }
        }
        
        self.categories = [
            "politics", "sports", "tech", "business", 
            "entertainment", "health", "science", "world news",
            "environment", "military", "crime", "economy"
        ]
        
        logger.info("EfficientNewsScraper initialized with CPU-only models")

    def migrate_categories(self):
        """Migrate existing JSON-serialized or comma-separated categories to single category string"""
        logger.info("Migrating categories in ChromaDB...")
        results = self.collection.get(include=["metadatas"])
        ids = results["ids"]
        metadatas = results["metadatas"]

        updated_metadatas = []
        for metadata in metadatas:
            try:
                categories = metadata.get("categories", "")
                if categories.startswith("["):  # JSON-serialized array
                    category_list = json.loads(categories)
                    if category_list:
                        metadata["categories"] = category_list[0]["category"]
                    else:
                        metadata["categories"] = "general"
                elif "," in categories:  # Comma-separated string
                    metadata["categories"] = categories.split(",")[0]
                elif not categories:  # Empty or missing
                    metadata["categories"] = "general"
                updated_metadatas.append(metadata)
            except Exception as e:
                logger.warning(f"Failed to migrate metadata for article: {e}")
                metadata["categories"] = "general"
                updated_metadatas.append(metadata)

        if updated_metadatas:
            self.collection.update(
                ids=ids,
                metadatas=updated_metadatas
            )
        logger.info("Category migration completed.")

    def generate_article_id(self, url, headline):
        """Generate unique ID for article"""
        unique_string = f"{url}_{headline}"
        return hashlib.md5(unique_string.encode()).hexdigest()

    def generate_embedding(self, text):
        """Generate embedding with batch processing for efficiency"""
        if not text.strip():
            return [0.0] * 384
        
        return self.embedding_model.encode(text, convert_to_tensor=False).tolist()

    def categorize_article(self, text, batch_mode=False):
        """Assign single category with highest confidence"""
        if not text.strip() or len(text.split()) < 3:
            return {"category": "general", "confidence": 1.0}
        
        try:
            result = self.categorizer(
                text,
                candidate_labels=self.categories,
                multi_label=False,
                hypothesis_template="This text is about {}."
            )
            
            top_category = result['labels'][0]
            top_score = result['scores'][0]
            
            return {
                "category": top_category,
                "confidence": round(float(top_score), 2)
            }
            
        except Exception as e:
            logger.warning(f"Categorization failed: {e}")
            return {"category": "general", "confidence": 1.0}

    def scrape_website(self, url, selectors, limit=None):
        """Scrape website using class-based selectors without card parent"""
        try:
            logger.info(f"Scraping {url}")
            
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                
                page.set_default_timeout(45000)
                page.goto(url, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(7000)
                
                html = page.content()
                browser.close()

            soup = BeautifulSoup(html, "html.parser")
            items = []
            
            containers = soup.select(selectors["container"])[:limit]
            logger.debug(f"Found {len(containers)} containers for {url}")

            for container in containers:
                try:
                    headline_elem = container.select_one(selectors["headline"])
                    headline = headline_elem.get_text(strip=True) if headline_elem else "No headline"
                    
                    desc_elem = container.select_one(selectors.get("description", "p"))
                    description = desc_elem.get_text(strip=True) if desc_elem else ""
                    
                    link_elem = container.select_one(selectors.get("link", "a"))
                    link = urljoin(url, link_elem["href"]) if link_elem and link_elem.get("href") else ""
                    
                    img_elem = container.select_one(selectors.get("image", "img"))
                    img = ""
                    if img_elem:
                        img_src = img_elem.get("src") or img_elem.get("data-src", "")
                        img = urljoin(url, img_src) if img_src else ""

                    if headline and link and headline != "No headline":
                        items.append({
                            "headline": headline,
                            "description": description,
                            "url": link,
                            "image": img,
                            "source": url,
                            "scraped_at": datetime.now().isoformat()
                        })
                        logger.debug(f"Scraped article: {headline[:50]}...")
                        
                except Exception as e:
                    logger.debug(f"Error processing container: {e}")
                    continue
                    
            if not items:
                logger.warning(f"No valid articles found for {url}")
            return items
            
        except Exception as e:
            logger.error(f"Error scraping {url}: {e}")
            return []

    def process_articles_batch(self, articles):
        """Process articles in batches for efficiency"""
        if not articles:
            return []

        texts_for_categorization = [
            f"{art['headline']} {art['description']}" for art in articles
        ]
        
        batch_size = 4
        categorized_articles = []
        
        for i in range(0, len(articles), batch_size):
            batch_articles = articles[i:i+batch_size]
            batch_texts = texts_for_categorization[i:i+batch_size]
            
            try:
                for j, text in enumerate(batch_texts):
                    category = self.categorize_article(text)
                    batch_articles[j]['categories'] = category
                    logger.debug(f"Article '{batch_articles[j]['headline'][:50]}...' categorized as: {category}")
                    categorized_articles.append(batch_articles[j])
                    
            except Exception as e:
                logger.warning(f"Batch categorization failed: {e}")
                categorized_articles.extend(batch_articles)
        
        return categorized_articles

    def store_in_chromadb(self, articles):
        """Efficient storage in ChromaDB"""
        if not articles:
            return

        ids, embeddings, documents, metadatas = [], [], [], []

        for article in articles:
            doc_text = f"{article['headline']} {article['description']}"
            
            embedding = self.generate_embedding(doc_text)
            
            article_id = self.generate_article_id(article['url'], article['headline'])
            
            ids.append(article_id)
            embeddings.append(embedding)
            documents.append(doc_text)
            metadatas.append({
                "headline": article['headline'],
                "description": article['description'][:500],
                "url": article['url'],
                "image": article.get('image', '')[:200],
                "source": article['source'],
                "scraped_at": article['scraped_at'],
                "categories": article.get('categories', {}).get('category', 'general'),
                "text_length": len(doc_text)
            })

        self.collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas
        )
        
        logger.info(f"Stored {len(articles)} articles in ChromaDB")

    def scrape_all_websites(self, max_articles_per_site=12):
        """Scrape all websites with resource limits"""
        all_articles = []
        
        for site_name, config in self.websites.items():
            try:
                logger.info(f"Processing {site_name}...")
                
                articles = self.scrape_website(
                    config["url"],
                    config["selectors"],
                    min(config["limit"], max_articles_per_site)
                )
                
                if articles:
                    processed_articles = self.process_articles_batch(articles)
                    self.store_in_chromadb(processed_articles)
                    all_articles.extend(processed_articles)
                    logger.info(f"Added {len(processed_articles)} articles from {site_name}")
                
                time.sleep(1)
                
            except Exception as e:
                logger.error(f"Failed to process {site_name}: {e}")
                continue

        return all_articles

    def search_articles(self, query, limit=5, category_filter=None):
        """Efficient search with optional category filtering"""
        query_embedding = self.generate_embedding(query)
        where_filter = None
        if category_filter:
            where_filter = {"categories": {"$eq": category_filter}}
        
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=limit,
            where=where_filter,
            include=["metadatas", "distances"]
        )
        
        return results

    def get_memory_usage(self):
        """Monitor memory usage"""
        import psutil
        process = psutil.Process()
        return process.memory_info().rss / 1024 / 1024  # MB

def main():
    logger.info("Starting efficient news scraping...")
    
    scraper = EfficientNewsScraper()
    
    start_memory = scraper.get_memory_usage()
    logger.info(f"Initial memory usage: {start_memory:.2f} MB")
    
    articles = scraper.scrape_all_websites(max_articles_per_site=12)
    if not articles:
        logger.warning("No articles were scraped from any websites.")
    
    end_memory = scraper.get_memory_usage()
    logger.info(f"Final memory usage: {end_memory:.2f} MB")
    logger.info(f"Memory delta: {end_memory - start_memory:.2f} MB")
    logger.info(f"Total articles processed: {len(articles)}")
    
    logger.info("Inspecting stored articles in ChromaDB:")
    results = scraper.search_articles("sports", limit=5, category_filter="sports")
    for i, metadata in enumerate(results['metadatas'][0]):
        logger.info(f"Stored article {i+1}: {metadata['headline']} (Source: {metadata['source']}, Category: {metadata['categories']})")
    
    with open('efficient_articles.json', 'w', encoding='utf-8') as f:
        json.dump(articles, f, indent=2, ensure_ascii=False)
    
    logger.info("Scraping completed successfully!")

if __name__ == "__main__":
    main()

def debug_website(url, name):
    """Generic debug function for any website"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        page.goto(url, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)
        
        page.screenshot(path=f"{name}_debug.png")
        
        html = page.content()
        browser.close()

    soup = BeautifulSoup(html, "html.parser")
    
    print(f"=== DEBUGGING {name.upper()} ===")
    
    common_patterns = ["sc-", "promo", "post", "card", "story", "article", "headline", "summary", "image"]
    
    for pattern in common_patterns:
        elements = soup.select(f'[class*="{pattern}"]')
        print(f"\nElements with '{pattern}' in class: {len(elements)}")
        if elements:
            for i, element in enumerate(elements[:3]):
                classes = element.get('class', [])
                print(f"  {i+1}. Classes: {classes}")
                print(f"     Text: {element.get_text(strip=True)[:100]}...")
                links = element.select('a')
                imgs = element.select('img')
                if links:
                    print(f"     Links: {len(links)}")
                if imgs:
                    print(f"     Images: {len(imgs)}")

    print("\n=== DATA-TESTID ATTRIBUTES ===")
    testid_elements = soup.select('[data-testid]')
    for element in testid_elements[:10]:
        testid = element.get('data-testid')
        print(f"data-testid: '{testid}'")
        print(f"  Classes: {element.get('class', [])}")
        print(f"  Text: {element.get_text(strip=True)[:50]}...")

    print("\n=== ARTICLES AND SECTIONS ===")
    articles = soup.select('article, section, [role="article"]')
    for i, article in enumerate(articles[:5]):
        print(f"\nArticle/Section {i+1}:")
        print(f"Classes: {article.get('class', [])}")
        headlines = article.select('h1, h2, h3, h4, [class*="headline"], [class*="title"]')
        for h in headlines:
            print(f"Headline: {h.get_text(strip=True)}")
        links = article.select('a')
        for link in links[:2]:
            href = link.get('href', '')
            if href:
                print(f"Link: {urljoin(url, href)}")
import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Loader2, Newspaper, Send } from "lucide-react";

export default function App() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState("");
  const [plan, setPlan] = useState(null);

  const askNews = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setResults([]);
    setSummary("");
    setPlan(null);

    try {
      const res = await fetch("http://localhost:5000/api/ask-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setResults(data.results || []);
      setSummary(data.summary || "");
      setPlan(data.plan || null);
    } catch (err) {
      console.error(err);
      setSummary("⚠️ Error fetching news.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white">
      {/* Header */}
      <header className="text-center py-12">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-4xl md:text-5xl font-extrabold flex justify-center items-center gap-3"
        >
          <Newspaper className="w-10 h-10 text-blue-400" /> AI News Agent
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="text-lg text-gray-400 mt-4"
        >
          Your smart assistant for the latest world, sports, business & tech news
        </motion.p>
      </header>

      {/* Input Box */}
      <main className="max-w-3xl mx-auto px-6">
        <Card className="bg-gray-800/60 border border-gray-700 shadow-lg rounded-2xl">
          <CardContent className="p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Ask me about the latest news..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="flex-1 bg-gray-900 px-4 py-3 rounded-xl border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button
                onClick={askNews}
                className="bg-blue-500 hover:bg-blue-600 rounded-xl px-5 py-2 flex items-center gap-2"
              >
                {loading ? (
                  <Loader2 className="animate-spin w-5 h-5" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
                Ask
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {summary && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mt-10"
          >
            <h2 className="text-2xl font-bold mb-4">📰 Summary</h2>
            <p className="bg-gray-900/70 p-5 rounded-xl border border-gray-700 leading-relaxed">
              {summary}
            </p>
          </motion.div>
        )}

        {plan && (
          <div className="mt-6 text-sm text-gray-400">
            <p>
              <strong>Agent Plan:</strong>{" "}
              {JSON.stringify(plan, null, 2)}
            </p>
          </div>
        )}

        {results.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7 }}
            className="mt-10 grid md:grid-cols-2 gap-6"
          >
            {results.map((news, idx) => (
              <Card
                key={idx}
                className="bg-gray-800/70 border border-gray-700 shadow-lg rounded-2xl hover:scale-[1.02] transition-transform"
              >
                <CardContent className="p-5">
                  <h3 className="text-xl font-semibold mb-2">
                    {news.headline}
                  </h3>
                  <p className="text-gray-400 text-sm mb-3">
                    {news.description}
                  </p>
                  <a
                    href={news.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline text-sm"
                  >
                    Read full article →
                  </a>
                  <p className="mt-2 text-xs text-gray-500">
                    {news.source} • {news.scraped_at}
                  </p>
                </CardContent>
              </Card>
            ))}
          </motion.div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-10 text-gray-500 text-sm">
        ⚡ Powered by <span className="text-blue-400">AI News Agent</span>
      </footer>
    </div>
  );
}

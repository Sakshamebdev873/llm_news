import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";

export default function Results({ summary, plan, results }) {
  return (
    <section className="space-y-6">
      {summary && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-gray-800 p-6 rounded-2xl shadow-lg"
        >
          <h2 className="text-xl font-bold mb-2 text-blue-400">Summary</h2>
          <p className="text-gray-300">{summary}</p>
        </motion.div>
      )}

      {plan && (
        <div className="bg-gray-900 p-4 rounded-xl border border-gray-700">
          <h3 className="text-lg font-semibold text-purple-400">Agent Plan</h3>
          <pre className="text-sm text-gray-400 mt-2">
            {JSON.stringify(plan, null, 2)}
          </pre>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {results.map((article, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="bg-gray-800 border border-gray-700 rounded-2xl shadow-md hover:shadow-xl transition">
              <CardContent className="p-4">
                {article.image_url && (
                  <img
                    src={article.image_url}
                    alt={article.headline}
                    className="w-full h-40 object-cover rounded-xl mb-3"
                  />
                )}
                <h3 className="font-bold text-lg mb-2">{article.headline}</h3>
                <p className="text-gray-400 text-sm mb-2">
                  {article.description}
                </p>
                <div className="text-xs text-gray-500">
                  Source: {article.source} |{" "}
                  {article.scraped_at?.split("T")[0] || "Unknown date"}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

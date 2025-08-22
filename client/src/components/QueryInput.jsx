import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export default function QueryInput({ question, setQuestion, askNews, loading }) {
  return (
    <div className="flex gap-2 items-center mb-10">
      <Input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask me about politics, sports, or world news..."
        className="flex-1 p-3 rounded-xl border border-gray-700 bg-gray-800 text-white"
      />
      <Button
        onClick={askNews}
        disabled={loading}
        className="bg-blue-500 hover:bg-blue-600 text-white px-5 py-3 rounded-xl"
      >
        {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Ask"}
      </Button>
    </div>
  );
}

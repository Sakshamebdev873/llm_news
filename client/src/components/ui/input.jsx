export function Input({ className = "", ...props }) {
  return (
    <input
      className={`w-full px-4 py-2 rounded-xl border border-gray-700 
        bg-gray-900 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 
        ${className}`}
      {...props}
    />
  );
}

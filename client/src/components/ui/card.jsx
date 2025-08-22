export function Card({ children, className = "", ...props }) {
  return (
    <div
      className={`rounded-2xl border border-gray-700 bg-gray-800 shadow-md ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({ children, className = "", ...props }) {
  return (
    <div className={`p-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

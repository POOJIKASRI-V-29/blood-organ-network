export default function Logo({ className = 'h-8 w-8' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 3.5s8.5 9.1 8.5 14.3A8.5 8.5 0 0 1 16 26.3a8.5 8.5 0 0 1-8.5-8.5C7.5 12.6 16 3.5 16 3.5Z"
            fill="#cf2048" />
      <path d="M16 11.4v8.4M11.8 15.6h8.4" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

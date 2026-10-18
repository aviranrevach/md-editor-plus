declare module '*.css' {
  const content: string;
  export default content;
}

declare module 'markdown-it-texmath' {
  const texmath: (md: unknown, options?: Record<string, unknown>) => void;
  export default texmath;
}

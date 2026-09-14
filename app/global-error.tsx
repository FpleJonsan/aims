"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><main style={{maxWidth:560,margin:"64px auto",padding:24,fontFamily:"sans-serif"}}><p>500 · UNEXPECTED ERROR</p><h1>AIMS couldn’t start</h1><p>Your data has not been changed. Try loading the application again.</p><button onClick={reset} style={{padding:"12px 18px"}}>Try again</button></main></body></html>;
}

"use client";

import { Button, Card, CardBody, Typography, UIProvider } from "./components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <UIProvider className="enterpriseStatePage"><main className="enterpriseMessage"><Card><CardBody><Typography as="span" className="enterpriseMessageCode">500 · UNEXPECTED ERROR</Typography><Typography as="h1" variant="page">AIMS couldn’t load this page</Typography><Typography>Your data has not been changed. Try loading the page again.</Typography><Button variant="primary" onClick={reset}>Try again</Button></CardBody></Card></main></UIProvider>;
}

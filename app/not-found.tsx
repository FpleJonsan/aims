import Link from "next/link";
import { Card, CardBody, Typography, UIProvider } from "./components/ui";

export default function NotFound() {
  return <UIProvider className="enterpriseStatePage"><main className="enterpriseMessage"><Card><CardBody><Typography as="span" className="enterpriseMessageCode">404 · NOT FOUND</Typography><Typography as="h1" variant="page">This page isn’t available</Typography><Typography>The address may be incorrect, or the page may have moved.</Typography><Link className="aims-button aims-button-primary" href="/">Return to AIMS</Link></CardBody></Card></main></UIProvider>;
}

import Link from "next/link";
import { Card, CardBody, Typography, UIProvider } from "../components/ui";

export default function SessionExpiredPage() {
  return <UIProvider className="enterpriseStatePage"><main className="enterpriseMessage"><Card><CardBody><Typography as="span" className="enterpriseMessageCode">SESSION EXPIRED</Typography><Typography as="h1" variant="page">Sign in again</Typography><Typography>Your session ended to protect your account. Your saved work remains available.</Typography><Link className="aims-button aims-button-primary" href="/login">Return to sign in</Link></CardBody></Card></main></UIProvider>;
}

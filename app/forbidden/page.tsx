import Link from "next/link";
import { Card, CardBody, Typography, UIProvider } from "../components/ui";

export default function ForbiddenPage() {
  return <UIProvider className="enterpriseStatePage"><main className="enterpriseMessage"><Card><CardBody><Typography as="span" className="enterpriseMessageCode">403 · PERMISSION REQUIRED</Typography><Typography as="h1" variant="page">You don’t have access</Typography><Typography>Your account is active, but the requested area is outside your assigned role or authority.</Typography><Link className="aims-button aims-button-primary" href="/">Return to your workspace</Link></CardBody></Card></main></UIProvider>;
}

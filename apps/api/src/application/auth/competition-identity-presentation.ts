const COMPETITION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "demo.requester": "Amelia Tan",
  "demo.finance": "Daniel Lim",
  "demo.approver": "Sarah Lee",
  "competition.manager": "Sarah Lee",
  "competition.director": "Adrian Ng",
  "competition.controller": "Michael Wong",
  "competition.payment": "Nora Ismail",
  "competition.reporting": "Grace Chen",
  "competition.admin": "Technical Administrator",
  "competition.requester.marketing": "Maya Rahman",
  "competition.requester.technology": "Ethan Teo",
};

export function competitionIdentityDisplayName(
  subject: string,
  storedDisplayName: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const competition = environment.AIMS_ENVIRONMENT === "competition" ||
    environment.AIMS_DEMO_MODE === "true";
  return competition ? (COMPETITION_DISPLAY_NAMES[subject] ?? storedDisplayName) : storedDisplayName;
}

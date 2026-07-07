import type { Position } from "@/types";

export const SEEDED_PUBLIC_POSITIONS: Position[] = [
  {
    id: "pos-fe",
    title: "Senior Frontend Developer",
    slug: "senior-frontend-developer",
    department: "Engineering",
    summary: "Build polished candidate and employer experiences across Ethara's hiring products.",
    description:
      "Join Ethara to craft a premium candidate experience and a fast, reliable recruiter platform. You'll work on modern frontend systems that sit at the center of our hiring and onboarding stack.",
    location: "Bengaluru, India",
    employmentType: "Full-time",
    workMode: "Hybrid",
    experienceLevel: "4-7 years",
    responsibilities: [
      "Own major UI surfaces for candidate onboarding and recruiter workflows.",
      "Collaborate closely with product, design, and backend teams to ship features quickly.",
      "Raise the bar on accessibility, performance, and design quality across the web app.",
    ],
    requirements: [
      "Strong React and TypeScript fundamentals in production systems.",
      "Experience building design-system driven interfaces with clean state management.",
      "Comfort translating fuzzy product goals into reliable frontend architecture.",
    ],
    preferredSkills: [
      "Next.js app router experience.",
      "Animation and micro-interaction design sense.",
      "Familiarity with hiring, HRMS, or workflow products.",
    ],
    benefits: [
      "Hybrid team with focused collaboration days.",
      "Equipment budget and learning stipend.",
      "High ownership on product direction and UI quality.",
    ],
    featured: true,
    openings: 2,
    postedAt: "2026-06-01T15:00:48.548856Z",
    urgencyLevel: 5,
    isActive: true,
    approvalStatus: "posted",
    createdAt: "2026-06-01T14:39:16.562317Z",
    updatedAt: "2026-06-01T15:00:48.690617Z",
  },
  {
    id: "pos-be",
    title: "Backend Engineer",
    slug: "backend-engineer",
    department: "Engineering",
    summary: "Design resilient APIs and workflow engines that power the hiring lifecycle.",
    description:
      "Work on the services that connect candidate registration, HR operations, screening, and onboarding. This role is ideal for engineers who enjoy pragmatic architecture and product depth.",
    location: "Bengaluru, India",
    employmentType: "Full-time",
    workMode: "Hybrid",
    experienceLevel: "3-6 years",
    responsibilities: [
      "Build FastAPI services for hiring workflows, automation, and integrations.",
      "Design clean schemas and background jobs for candidate lifecycle events.",
      "Improve observability, security, and reliability across backend systems.",
    ],
    requirements: [
      "Strong Python backend experience with SQL and API design.",
      "Hands-on understanding of async workflows, queues, and auth patterns.",
      "Ability to own features from data model through production rollout.",
    ],
    preferredSkills: [
      "FastAPI or Django experience.",
      "PostgreSQL performance tuning.",
      "Exposure to OCR, workflow, or document-processing platforms.",
    ],
    benefits: [
      "Ownership over business-critical systems.",
      "Mentorship from senior product and platform leaders.",
      "Flexible hybrid work model.",
    ],
    featured: true,
    openings: 3,
    postedAt: "2026-06-01T15:00:48.548856Z",
    urgencyLevel: 4,
    isActive: true,
    approvalStatus: "posted",
    createdAt: "2026-06-01T14:39:16.564316Z",
    updatedAt: "2026-06-01T15:00:48.692363Z",
  },
  {
    id: "pos-ds",
    title: "Data Scientist",
    slug: "data-scientist",
    department: "Data & AI",
    summary: "Turn hiring and onboarding data into better screening, forecasting, and automation.",
    description:
      "Help Ethara blend operational rigor with applied AI. You'll work on ranking, extraction, and decision-support systems that make our hiring workflows sharper and faster.",
    location: "Remote, India",
    employmentType: "Full-time",
    workMode: "Remote",
    experienceLevel: "2-5 years",
    responsibilities: [
      "Prototype and productionize ML models for screening and operations insights.",
      "Partner with product teams on measurable AI-assisted workflows.",
      "Build experimentation and reporting layers for model quality and fairness.",
    ],
    requirements: [
      "Strong Python and applied ML fundamentals.",
      "Experience cleaning real-world datasets and shipping measurable models.",
      "Solid communication around tradeoffs, metrics, and experimentation.",
    ],
    preferredSkills: [
      "LLM-assisted extraction or ranking systems.",
      "Analytics dashboards and stakeholder reporting.",
      "Prior work in talent, marketplace, or ops platforms.",
    ],
    benefits: [
      "Remote-first collaboration with in-person meetups.",
      "Wide scope across AI, product, and operations.",
      "Learning budget for conferences and courses.",
    ],
    featured: false,
    openings: 1,
    postedAt: "2026-06-01T15:00:48.548856Z",
    urgencyLevel: 3,
    isActive: true,
    approvalStatus: "posted",
    createdAt: "2026-06-01T14:39:16.565579Z",
    updatedAt: "2026-06-01T15:00:48.693402Z",
  },
];

export function getSeededPublicPosition(slugOrId: string): Position | null {
  return (
    SEEDED_PUBLIC_POSITIONS.find((position) => position.slug === slugOrId || position.id === slugOrId) ?? null
  );
}

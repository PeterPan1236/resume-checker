// Job-family profiles. Each profile drives keyword-coverage scoring and gives the
// model a role-specific rubric instead of generic resume advice.

export const JOB_PROFILES = {
  software_engineer: {
    label: 'Software Engineer',
    focus:
      'shipped systems, ownership scope, code quality, scale/latency/reliability numbers, cross-team collaboration',
    hardSkills: [
      'python', 'java', 'javascript', 'typescript', 'go', 'c++', 'rust', 'react',
      'node', 'sql', 'postgres', 'mysql', 'mongodb', 'redis', 'docker', 'kubernetes', 'aws',
      'gcp', 'azure', 'ci/cd', 'terraform', 'api', 'rest', 'graphql', 'microservices', 'git',
      'testing', 'unit test', 'linux'
    ],
    softSkills: ['mentored', 'code review', 'cross-functional', 'on-call', 'design doc', 'architecture'],
    signals: [
      'Latency / throughput / uptime numbers',
      'Scale of system (users, QPS, data volume)',
      'End-to-end ownership of a service or feature',
      'Testing and deployment practices'
    ]
  },
  data_scientist: {
    label: 'Data Scientist / ML Engineer',
    focus: 'modelling rigour, business impact of models, experimentation, data scale, models reaching production',
    hardSkills: [
      'python', 'r', 'sql', 'pandas', 'numpy', 'scikit-learn', 'pytorch', 'tensorflow', 'spark',
      'airflow', 'dbt', 'bigquery', 'snowflake', 'tableau', 'power bi', 'a/b test', 'regression',
      'classification', 'nlp', 'llm', 'feature engineering', 'mlops', 'statistics', 'etl'
    ],
    softSkills: ['stakeholder', 'presented', 'experiment design', 'hypothesis', 'cross-functional'],
    signals: [
      'Model performance deltas (AUC, precision, RMSE) against a baseline',
      'Business metric moved by the model (revenue, churn, cost)',
      'Data volume and pipeline ownership',
      'Whether models reached production'
    ]
  },
  product_manager: {
    label: 'Product Manager',
    focus: 'outcomes over output, user and market insight, prioritisation, leadership without authority',
    hardSkills: [
      'roadmap', 'prd', 'a/b test', 'okr', 'kpi', 'user research', 'analytics', 'sql', 'jira',
      'figma', 'go-to-market', 'discovery', 'segmentation', 'pricing', 'backlog', 'stakeholder'
    ],
    softSkills: ['led', 'aligned', 'influenced', 'negotiated', 'partnered', 'drove'],
    signals: [
      'Product metrics moved (activation, retention, ARR, conversion)',
      'Size of team and scope of surface owned',
      'Evidence of user research feeding decisions',
      'Launch outcomes, not launch announcements'
    ]
  },
  marketing: {
    label: 'Marketing / Growth',
    focus: 'funnel metrics, channel ownership, budget scale, creative and analytical balance',
    hardSkills: [
      'seo', 'sem', 'google ads', 'meta ads', 'hubspot', 'marketo', 'salesforce', 'ga4',
      'analytics', 'email marketing', 'content strategy', 'crm', 'attribution', 'roas', 'cac',
      'ltv', 'conversion rate', 'campaign', 'brand', 'copywriting', 'social media'
    ],
    softSkills: ['launched', 'scaled', 'partnered', 'managed budget', 'cross-functional'],
    signals: [
      'CAC / ROAS / conversion-rate deltas',
      'Budget managed and channel mix',
      'Pipeline or revenue attributed',
      'Audience or traffic growth against a baseline'
    ]
  },
  sales: {
    label: 'Sales / Account Management',
    focus: 'quota attainment, deal size, pipeline generation, territory and segment',
    hardSkills: [
      'quota', 'pipeline', 'salesforce', 'hubspot', 'crm', 'saas', 'b2b', 'enterprise',
      'prospecting', 'cold outreach', 'negotiation', 'forecasting', 'mrr', 'arr', 'renewal',
      'upsell', 'churn', 'meddic', 'solution selling', 'rfp'
    ],
    softSkills: ['closed', 'exceeded', 'built relationships', 'presented', 'negotiated'],
    signals: [
      'Quota attainment as a percentage, with the quota size',
      'Average deal size and sales cycle',
      'Ranking within the team (e.g. 2nd of 40 reps)',
      'New-logo versus expansion split'
    ]
  },
  finance: {
    label: 'Finance / Accounting',
    focus: 'accuracy, controls, reporting scale, systems, certifications',
    hardSkills: [
      'excel', 'sap', 'oracle', 'netsuite', 'quickbooks', 'gaap', 'ifrs', 'financial modeling',
      'forecasting', 'budgeting', 'variance analysis', 'audit', 'reconciliation', 'fp&a',
      'month-end close', 'cpa', 'cfa', 'valuation', 'dcf', 'sql', 'power bi', 'tableau'
    ],
    softSkills: ['partnered', 'presented to leadership', 'streamlined', 'controls'],
    signals: [
      'Size of budget, portfolio, or revenue supported',
      'Close-cycle days reduced, error rates cut',
      'Systems implemented or migrated',
      'Certifications and licence status'
    ]
  },
  design: {
    label: 'Product / UX Design',
    focus: 'process from research to ship, measurable UX outcomes, systems thinking, portfolio link',
    hardSkills: [
      'figma', 'sketch', 'adobe', 'prototyping', 'wireframe', 'design system', 'user research',
      'usability testing', 'accessibility', 'wcag', 'interaction design', 'ux', 'ui',
      'information architecture', 'html', 'css', 'motion'
    ],
    softSkills: ['collaborated', 'facilitated', 'workshop', 'critique', 'stakeholder'],
    signals: [
      'Portfolio URL present and specific',
      'Usability or conversion metrics improved',
      'Design-system adoption and scale',
      'Research methods actually used'
    ]
  },
  operations: {
    label: 'Operations / Project Management',
    focus: 'process improvement, cost and time savings, team and vendor scale, tooling',
    hardSkills: [
      'process improvement', 'lean', 'six sigma', 'kpi', 'sop', 'supply chain', 'logistics',
      'vendor management', 'erp', 'sap', 'excel', 'sql', 'project management', 'pmp', 'agile',
      'scrum', 'stakeholder management', 'capacity planning', 'budget'
    ],
    softSkills: ['coordinated', 'led', 'trained', 'standardised', 'escalation'],
    signals: [
      'Cost or cycle-time reduction against a baseline',
      'Headcount, vendors, or sites coordinated',
      'Process documented and adopted',
      'Project budget and on-time delivery'
    ]
  },
  healthcare: {
    label: 'Healthcare / Clinical',
    focus: 'licensure, patient volume, care-quality metrics, compliance, specialty depth',
    hardSkills: [
      'patient care', 'ehr', 'epic', 'cerner', 'hipaa', 'clinical', 'triage', 'bls', 'acls',
      'licensed', 'rn', 'charting', 'infection control', 'quality improvement', 'care plan',
      'medication administration', 'discharge planning'
    ],
    softSkills: ['collaborated', 'educated patients', 'precepted', 'interdisciplinary'],
    signals: [
      'Licence type, state, and expiry',
      'Patient load, bed count, or acuity',
      'Quality or safety metrics improved',
      'Certifications current'
    ]
  },
  general: {
    label: 'General / Other',
    focus: 'clarity, quantified impact, relevance to the target role, clean structure',
    hardSkills: ['excel', 'project management', 'analysis', 'reporting', 'crm', 'sql', 'presentation'],
    softSkills: ['led', 'managed', 'improved', 'collaborated', 'trained'],
    signals: [
      'Every bullet shows an outcome, not a duty',
      'Consistent reverse-chronological structure',
      'Relevance to the target role is obvious in the top third'
    ]
  }
};

export const SENIORITY = {
  intern: 'Intern / student — coursework and projects count; expect 1 page and limited scope.',
  entry: 'Entry level (0-2 yrs) — projects and internships carry weight; 1 page.',
  mid: 'Mid level (3-6 yrs) — expect clear ownership and quantified outcomes; 1-2 pages.',
  senior: 'Senior (7-12 yrs) — expect scope, influence, and technical or strategic depth; 2 pages.',
  lead: 'Lead / Manager / Director — expect team size, budget, and org-level outcomes; 2-3 pages.'
};

export function listJobs() {
  return Object.entries(JOB_PROFILES).map(([id, p]) => ({ id, label: p.label }));
}

export function listSeniority() {
  return Object.entries(SENIORITY).map(([id, hint]) => ({ id, hint }));
}

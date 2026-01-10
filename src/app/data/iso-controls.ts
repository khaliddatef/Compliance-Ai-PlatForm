export type IsoControl = {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  testComponents: string[];
};

export const ISO_CONTROLS: IsoControl[] = [
  {
    id: 'A.5.1',
    title: 'Information security policies',
    summary: 'Policies must be defined, approved, and communicated.',
    evidence: [
      'Information Security Policy document',
      'Management approval/sign-off evidence',
      'Review schedule or version history'
    ],
    testComponents: ['A.5.1.1 Policy exists', 'A.5.1.2 Approved by management', 'A.5.1.3 Reviewed periodically']
  },
  {
    id: 'A.5.2',
    title: 'Information security roles and responsibilities',
    summary: 'Roles and responsibilities must be defined and assigned.',
    evidence: [
      'Org chart or RACI',
      'Job descriptions with security responsibilities',
      'Appointment letters / acknowledgements'
    ],
    testComponents: ['A.5.2.1 Roles defined', 'A.5.2.2 Responsibilities assigned']
  },
  {
    id: 'A.6.1',
    title: 'Screening',
    summary: 'Background screening requirements are defined and applied.',
    evidence: [
      'Screening policy',
      'Sample screening records or HR checklist',
      'Hiring procedure showing screening step'
    ],
    testComponents: ['A.6.1.1 Screening policy', 'A.6.1.2 Screening performed']
  },
  {
    id: 'A.8.2',
    title: 'Information classification',
    summary: 'Information is classified by value and sensitivity.',
    evidence: [
      'Classification policy',
      'Data classification matrix',
      'Examples of labeled documents'
    ],
    testComponents: ['A.8.2.1 Classification scheme', 'A.8.2.2 Labeling applied']
  },
  {
    id: 'A.9.1',
    title: 'Access control policy',
    summary: 'Access control is defined, enforced, and reviewed.',
    evidence: [
      'Access control policy',
      'MFA/SSO configuration screenshots',
      'Access review reports or tickets'
    ],
    testComponents: ['A.9.1.1 Policy defined', 'A.9.1.2 Access enforced', 'A.9.1.3 Reviews performed']
  }
];

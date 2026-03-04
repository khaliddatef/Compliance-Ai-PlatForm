import {
  DocumentAnalysisInsights,
  DocumentInsightsService,
} from './document-insights.service';

describe('DocumentInsightsService', () => {
  let service: DocumentInsightsService;

  beforeEach(() => {
    service = new DocumentInsightsService();
  });

  it('extracts governance, controls, obligations, artifacts, and signals from readable text', () => {
    const content = `
      Endpoint Security Policy
      Version: 2.1
      Owner: Security Manager
      Approved by: CISO
      Approval date: 2026-02-01
      Effective date: 2026-02-10
      Next review: 2027-02-10

      Control A.8.26 applies to endpoint hardening.
      All endpoints must run endpoint protection and EDR.
      The security team shall review audit logs monthly.
      Incident response is required within 24 hours as an SLA target.
      Exceptions are allowed only with approval by CISO.
      CVSS high vulnerabilities must be remediated quickly.
    `;

    const output = service.extract({
      document: {
        id: 'doc-1',
        originalName: 'Endpoint Security Policy.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 2048,
        checksumSha256: 'abc123',
      },
      content,
      chunks: [
        { chunkIndex: 0, text: content.slice(0, 380) },
        { chunkIndex: 1, text: content.slice(380) },
      ],
      context: {
        matchControlId: 'A.8.26',
        matchStatus: 'PARTIAL',
      },
    });

    expect(output.metadata.fileType).toBe('DOCX');
    expect(output.metadata.wordCount).toBeGreaterThan(20);
    expect(output.governance.policyTitle?.value).toContain('Endpoint Security Policy');
    expect(output.governance.version?.value).toBe('2.1');
    expect(output.governance.owner?.value).toContain('Security Manager');
    expect(output.governance.approvedBy?.value).toContain('CISO');
    expect(output.controlReferences.some((item) => item.controlCode === 'A.8.26')).toBe(true);
    expect(output.obligations.length).toBeGreaterThan(1);
    expect(output.evidenceArtifacts.some((item) => item.type === 'LOGS')).toBe(true);
    expect(output.operationalSignals.frequencies.length).toBeGreaterThan(0);
    expect(output.operationalSignals.slaTargets.length).toBeGreaterThan(0);
    expect(output.exceptions.length).toBeGreaterThan(0);
    expect(output.riskSignals.cvssMentions.length).toBeGreaterThan(0);
    expect(output.grounding.sourceCoverage).toBe(100);
  });

  it('produces reupload action and core gaps when text is missing', () => {
    const output = service.extract({
      document: {
        id: 'doc-empty',
        originalName: 'Scanned.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        checksumSha256: null,
      },
      content: '',
      chunks: [],
      context: {
        matchStatus: 'UNKNOWN',
      },
    });

    expect(output.metadata.wordCount).toBe(0);
    expect(output.gaps.some((gap) => gap.code === 'MISSING_CONTROL_REFERENCE')).toBe(true);
    expect(output.suggestedActions[0]?.actionType).toBe('REUPLOAD');
  });

  it('updates metadata and source refs when cloning duplicate analysis', () => {
    const base = service.extract({
      document: {
        id: 'doc-base',
        originalName: 'Policy.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1024,
        checksumSha256: 'base',
      },
      content: 'Policy Owner: Security Lead. Control A.8.26 must be reviewed monthly.',
      chunks: [{ chunkIndex: 0, text: 'Policy Owner: Security Lead. Control A.8.26 must be reviewed monthly.' }],
      context: {
        matchControlId: 'A.8.26',
      },
    });

    const cloned = service.cloneForDuplicate({
      existing: base,
      documentId: 'doc-dup',
      duplicateOfDocumentId: 'doc-base',
      fileName: 'Policy_2.docx',
      checksumSha256: 'dup',
    }) as DocumentAnalysisInsights;

    expect(cloned).toBeTruthy();
    expect(cloned.metadata.fileName).toBe('Policy_2.docx');
    expect(cloned.metadata.duplicateOfDocumentId).toBe('doc-base');
    expect(cloned.metadata.checksumSha256).toBe('dup');
    expect(cloned.governance.policyTitle?.sourceRef.documentId).toBe('doc-dup');
  });
});

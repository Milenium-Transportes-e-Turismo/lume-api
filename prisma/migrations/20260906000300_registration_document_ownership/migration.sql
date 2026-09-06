ALTER TABLE routing_companies ADD COLUMN document_profile JSONB;
ALTER TABLE document_requests ADD COLUMN subject_registration_id UUID;
ALTER TABLE document_requests ALTER COLUMN subject_user_id DROP NOT NULL;
ALTER TABLE document_requests ADD CONSTRAINT document_requests_registration_fkey FOREIGN KEY (subject_registration_id, company_id) REFERENCES routing_companies(id, company_id) ON DELETE RESTRICT;
ALTER TABLE document_requests ADD CONSTRAINT document_requests_subject_required CHECK (subject_user_id IS NOT NULL OR subject_registration_id IS NOT NULL);
CREATE INDEX document_requests_registration_idx ON document_requests(company_id, subject_registration_id, status);
-- Only explicit person associations are eligible; ambiguous profiles are preserved in users.
WITH profiles AS (
 SELECT company_id, person_registration_id, MIN(id::text) AS source_id
 FROM users WHERE person_registration_id IS NOT NULL
 GROUP BY company_id, person_registration_id
 HAVING COUNT(DISTINCT jsonb_build_object('jobTitle',job_title,'maritalStatus',marital_status,'militaryDocumentStatus',military_document_status,'dependents',dependents)) = 1
)
UPDATE routing_companies r SET document_profile = jsonb_build_object('jobTitle',u.job_title,'maritalStatus',u.marital_status,'militaryDocumentStatus',u.military_document_status,'dependents',u.dependents)
FROM profiles p JOIN users u ON u.id::text = p.source_id
WHERE r.id = p.person_registration_id AND r.company_id = p.company_id AND r.client_type = 'pf';
UPDATE document_requests d SET subject_registration_id = u.person_registration_id
FROM users u WHERE d.subject_user_id = u.id AND d.company_id = u.company_id AND u.person_registration_id IS NOT NULL;

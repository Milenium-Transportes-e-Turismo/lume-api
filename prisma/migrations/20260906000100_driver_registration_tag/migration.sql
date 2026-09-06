-- Retain historical role assignments; add their meaning to tags before retiring the role.
INSERT INTO registration_tags (id, company_id, code, name, active, created_at, updated_at)
SELECT gen_random_uuid(), c.id, 'driver', 'Motorista', true, now(), now()
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM registration_tags t WHERE t.company_id=c.id
  AND (t.code='driver' OR lower(trim(t.name))='motorista')
)
ON CONFLICT (company_id, code) DO NOTHING;

UPDATE registration_tags t SET active=true, updated_at=now()
WHERE t.id IN (
 SELECT DISTINCT ON (company_id) id FROM registration_tags
 WHERE code='driver' OR lower(trim(name))='motorista'
 ORDER BY company_id, (code='driver') DESC, created_at ASC
);

INSERT INTO registration_tag_assignments (id, company_id, registration_id, tag_id, assigned_by_user_id, created_at)
SELECT gen_random_uuid(), a.company_id, a.registration_id,
  (SELECT t.id FROM registration_tags t WHERE t.company_id=a.company_id
   AND (t.code='driver' OR lower(trim(t.name))='motorista')
   ORDER BY (t.code='driver') DESC, t.created_at ASC LIMIT 1),
  a.assigned_by_user_id, now()
FROM registration_role_assignments a
JOIN registration_roles r ON r.id=a.role_id AND r.company_id=a.company_id
WHERE r.code='driver'
ON CONFLICT (company_id, registration_id, tag_id) DO NOTHING;

UPDATE registration_roles SET active=false, updated_at=now() WHERE code='driver';

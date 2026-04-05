-- Rename persisted agent identifiers (strict rename; no alias for old values).
UPDATE messages SET role = 'ada' WHERE role = 'marie';
UPDATE messages SET role = 'leo' WHERE role = 'roy';
UPDATE memory SET agent = 'ada' WHERE agent = 'marie';
UPDATE memory SET agent = 'leo' WHERE agent = 'roy';

-- Adds a STUDENT audience so an admin can send a test announcement/push to just one account
-- instead of broadcasting to everyone. Split from 0006 on purpose: a freshly added enum value
-- can't be referenced in the same transaction that creates it, and each migration file runs
-- in its own transaction.
alter type announcement_audience add value 'STUDENT';

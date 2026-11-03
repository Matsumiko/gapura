-- Artefak pembayaran dari respons inquiry Duitku, dikembalikan ke project.
ALTER TABLE transactions ADD COLUMN va_number TEXT;
ALTER TABLE transactions ADD COLUMN qr_string TEXT;

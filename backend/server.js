const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const SCHOOL_NAME = process.env.SCHOOL_NAME || "SD Nusantara Global";
const SCHOOL_EMAIL = process.env.SCHOOL_EMAIL || "sekolah@example.com";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Database SQLite
const dbPath = path.resolve(__dirname, 'consent_database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS consent_forms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            form_id TEXT UNIQUE NOT NULL,
            student_name TEXT NOT NULL,
            parent_name TEXT NOT NULL,
            parent_email TEXT NOT NULL,
            consent TEXT NOT NULL,
            signature TEXT NOT NULL,
            submitted_at DATETIME NOT NULL
        )
    `);
});

// Setup Nodemailer SMTP Email
const createTransporter = () => {
    if (!SMTP_USER || !SMTP_PASS) return null;
    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
};

const transporter = createTransporter();

function generateFormId() {
    const today = new Date();
    const YYYY = today.getFullYear();
    const MM = String(today.getMonth() + 1).padStart(2, '0');
    const DD = String(today.getDate()).padStart(2, '0');
    const RAND = Math.floor(1000 + Math.random() * 9000);
    return `PPF-${YYYY}${MM}${DD}-${RAND}`;
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Backend Server Berjalan Normal' });
});

app.post('/api/consent', async (req, res) => {
    try {
        const { student_name, parent_name, parent_email, consent, signature, submitted_at } = req.body;

        if (!student_name || !parent_name || !parent_email || !consent || !signature) {
            return res.status(400).json({ success: false, message: 'Data formulir tidak lengkap.' });
        }

        const form_id = generateFormId();
        const timestamp = submitted_at || new Date().toISOString();

        // Simpan Data ke Database
        const stmt = db.prepare(`
            INSERT INTO consent_forms (form_id, student_name, parent_name, parent_email, consent, signature, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(form_id, student_name, parent_name, parent_email, consent, signature, timestamp, async function(err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Gagal menyimpan ke database.' });
            }

            // Kirim Email (Jika SMTP Sudah Dikonfigurasi)
            if (transporter) {
                const base64Data = signature.replace(/^data:image\/\w+;base64,/, "");
                const signatureBuffer = Buffer.from(base64Data, 'base64');

                const mailOptions = {
                    from: `"${SCHOOL_NAME}" <${SCHOOL_EMAIL}>`,
                    to: `${SCHOOL_EMAIL}, ${parent_email}`,
                    subject: `[Persetujuan Foto] ${student_name} - ${consent}`,
                    html: `
                        <h2>${SCHOOL_NAME}</h2>
                        <p><strong>Nomor Formulir:</strong> ${form_id}</p>
                        <p><strong>Nama Anak:</strong> ${student_name}</p>
                        <p><strong>Nama Orang Tua:</strong> ${parent_name}</p>
                        <p><strong>Email Orang Tua:</strong> ${parent_email}</p>
                        <p><strong>Pilihan Persetujuan:</strong> ${consent}</p>
                        <p><strong>Waktu:</strong> ${new Date(timestamp).toLocaleString('id-ID')}</p>
                        <br/>
                        <p><strong>Tanda Tangan Digital:</strong></p>
                        <img src="cid:signatureImage" style="max-width:300px; border:1px solid #ccc;" />
                    `,
                    attachments: [{
                        filename: 'signature.png',
                        content: signatureBuffer,
                        cid: 'signatureImage'
                    }]
                };

                try {
                    await transporter.sendMail(mailOptions);
                } catch (emailErr) {
                    console.log('Email pengiriman bermasalah:', emailErr.message);
                }
            }

            return res.json({ success: true, form_id: form_id });
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server Backend aktif di port: http://localhost:${PORT}`);
});
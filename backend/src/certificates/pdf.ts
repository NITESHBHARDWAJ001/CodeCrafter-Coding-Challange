import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { DateTime } from 'luxon';

export interface CertificateData {
  recipientName: string;
  programName: string;
  completed: number;
  total: number;
  code: string;
  issuedAt: Date;
  verifyUrl: string;
}

const NAVY = '#101b36';
const ORANGE = '#e8742a';
const ORANGE_SOFT = '#fbe6d6';
const MUTED = '#5b6578';
const CREAM = '#fbfaf6';

const LOGO = fs.readFileSync(path.join(__dirname, 'assets', 'logo.png'));

/** A4 landscape certificate. Returns the PDF bytes. */
export async function renderCertificatePdf(d: CertificateData): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.verifyUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M', color: { dark: NAVY, light: '#00000000' } });
  const doc = new PDFDocument({
    size: 'A4', layout: 'landscape', margin: 0,
    info: { Title: `Certificate ${d.code}`, Author: 'CodeCrafter Club, IIT Madras', Subject: d.programName },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = doc.page.width, H = doc.page.height;

  // ── background + frame ──
  doc.rect(0, 0, W, H).fill(CREAM);
  doc.lineWidth(2.5).strokeColor(NAVY).rect(20, 20, W - 40, H - 40).stroke();
  doc.lineWidth(1).strokeColor(ORANGE).rect(29, 29, W - 58, H - 58).stroke();

  // corner tick marks (echoes the logo's reticle motif)
  const ticks = (x: number, y: number, dx: number, dy: number) => {
    doc.lineWidth(1.5).strokeColor(ORANGE);
    for (let i = 0; i < 3; i++) {
      const o = i * 9;
      doc.moveTo(x + dx * o, y).lineTo(x + dx * (o + 14), y).stroke();
      doc.moveTo(x, y + dy * o).lineTo(x, y + dy * (o + 14)).stroke();
    }
  };
  ticks(42, 42, 1, 1);
  ticks(W - 42, 42, -1, 1);
  ticks(42, H - 42, 1, -1);
  ticks(W - 42, H - 42, -1, -1);

  // ── header: circular logo badge ──
  const cx = W / 2, cy = 84, r = 34;
  doc.save();
  doc.circle(cx, cy, r).clip();
  doc.image(LOGO, cx - r, cy - r, { width: r * 2, height: r * 2 });
  doc.restore();
  doc.lineWidth(1.5).strokeColor(ORANGE).circle(cx, cy, r).stroke();

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(19).text('CODECRAFTER CLUB', 0, 130, { align: 'center', characterSpacing: 2 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text('INDIAN INSTITUTE OF TECHNOLOGY MADRAS', 0, 152, { align: 'center', characterSpacing: 2.5 });
  doc.moveTo(W / 2 - 50, 171).lineTo(W / 2 + 50, 171).lineWidth(1.5).strokeColor(ORANGE).stroke();

  // ── body ──
  doc.fillColor(NAVY).font('Times-Bold').fontSize(32).text('Certificate of Completion', 0, 184, { align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(12).text('This certifies that', 0, 234, { align: 'center' });
  doc.fillColor(NAVY).font('Times-BoldItalic').fontSize(34).text(d.recipientName, 60, 254, { align: 'center', width: W - 120 });
  doc.moveTo(W / 2 - 190, 302).lineTo(W / 2 + 190, 302).lineWidth(0.8).strokeColor(ORANGE).stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(12).text('has successfully completed', 0, 314, { align: 'center' });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(23).text(d.programName, 60, 335, { align: 'center', width: W - 120 });

  // completion pill
  const pillText = `${d.completed} / ${d.total} Challenges Completed`;
  doc.font('Helvetica-Bold').fontSize(11);
  const pillW = doc.widthOfString(pillText) + 44, pillH = 24;
  doc.roundedRect(W / 2 - pillW / 2, 374, pillW, pillH, pillH / 2).fill(ORANGE_SOFT);
  doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(11).text(pillText, W / 2 - pillW / 2, 374 + 7, { width: pillW, align: 'center', characterSpacing: 0.5 });

  // ── footer (kept well inside the inner border, which sits at H-29) ──
  const y = H - 150;
  doc.moveTo(60, y - 22).lineTo(W - 60, y - 22).lineWidth(0.6).strokeColor('#e3ddd0').stroke();

  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text('CERTIFICATE ID', 80, y, { characterSpacing: 1 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(d.code, 80, y + 14);
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text('ISSUE DATE', 80, y + 42, { characterSpacing: 1 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(DateTime.fromJSDate(d.issuedAt).setZone('Asia/Kolkata').toFormat('dd LLL yyyy'), 80, y + 56);

  doc.image(qr, W - 80 - 72, y - 10, { width: 72 });
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5).text('SCAN TO VERIFY', W - 80 - 72, y + 64, { width: 72, align: 'center', characterSpacing: 0.5 });

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('CodeCrafter Club · IIT Madras', 0, H - 60, { align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(d.verifyUrl, 0, H - 46, { align: 'center' });

  doc.end();
  return done;
}

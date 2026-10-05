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

const INK = '#13213f';
const GOLD = '#b8892b';
const MUTED = '#5b6578';

/** A4 landscape certificate. Returns the PDF bytes. */
export async function renderCertificatePdf(d: CertificateData): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.verifyUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
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
  doc.rect(0, 0, W, H).fill('#fbfaf6');
  doc.lineWidth(3).strokeColor(INK).rect(22, 22, W - 44, H - 44).stroke();
  doc.lineWidth(1).strokeColor(GOLD).rect(32, 32, W - 64, H - 64).stroke();

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('CodeCrafter Club', 0, 62, { align: 'center', characterSpacing: 2 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(12).text('INDIAN INSTITUTE OF TECHNOLOGY MADRAS', 0, 90, { align: 'center', characterSpacing: 3 });
  doc.moveTo(W / 2 - 60, 116).lineTo(W / 2 + 60, 116).lineWidth(1.5).strokeColor(GOLD).stroke();

  doc.fillColor(INK).font('Times-Bold').fontSize(40).text('Certificate of Completion', 0, 134, { align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(13).text('This certifies that', 0, 200, { align: 'center' });
  doc.fillColor(INK).font('Times-BoldItalic').fontSize(40).text(d.recipientName, 60, 224, { align: 'center', width: W - 120 });
  doc.moveTo(W / 2 - 200, 278).lineTo(W / 2 + 200, 278).lineWidth(0.8).strokeColor(GOLD).stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(13).text('successfully completed', 0, 292, { align: 'center' });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(26).text(d.programName, 60, 314, { align: 'center', width: W - 120 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(13)
    .text(`Completion: ${d.completed} / ${d.total} Challenges`, 0, 362, { align: 'center' });

  const issued = DateTime.fromJSDate(d.issuedAt).setZone('Asia/Kolkata').toFormat('dd LLL yyyy');
  const y = H - 128;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('CERTIFICATE ID', 80, y, { characterSpacing: 1 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(d.code, 80, y + 14);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('ISSUE DATE', 80, y + 42, { characterSpacing: 1 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(issued, 80, y + 56);

  doc.image(qr, W - 80 - 78, y - 12, { width: 78 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Scan to verify', W - 80 - 78, y + 70, { width: 78, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(d.verifyUrl, 0, H - 52, { align: 'center' });

  doc.end();
  return done;
}

// worker/src/services/pdf-generator.service.ts
// Uses pdfmake (zero-dependency PDF) instead of puppeteer to avoid 300MB/instance RAM
import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pino from 'pino';

const log = pino({ name: 'pdf-generator' });

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
});

const BUCKET = process.env.S3_REPORTS_BUCKET!;

const fonts = {
  Roboto: {
    normal: 'node_modules/pdfmake/build/vfs_fonts.js',
    bold: 'node_modules/pdfmake/build/vfs_fonts.js',
    italics: 'node_modules/pdfmake/build/vfs_fonts.js',
    bolditalics: 'node_modules/pdfmake/build/vfs_fonts.js',
  },
};

export interface ReportData {
  tenantId: string;
  reportId: string;
  title: string;
  vehicle?: {
    plate?: string;
    vin?: string;
    make?: string;
    model?: string;
    year?: number;
    ownerName?: string;
  };
  cardReads: Array<{
    id: string;
    cardType: string;
    cardSerial: string;
    readStatus: string;
    createdAt: string;
  }>;
  generatedAt: string;
}

export async function generateAndUploadPdf(data: ReportData): Promise<string> {
  const docDef: TDocumentDefinitions = {
    content: [
      { text: data.title, style: 'header' },
      { text: `Generated: ${data.generatedAt}`, style: 'subheader' },
      { text: '' },
      ...(data.vehicle ? [
        { text: 'Vehicle', style: 'sectionHeader' },
        {
          table: {
            body: [
              ['Plate', data.vehicle.plate ?? '—'],
              ['VIN', data.vehicle.vin ?? '—'],
              ['Make / Model', `${data.vehicle.make ?? ''} ${data.vehicle.model ?? ''}`.trim() || '—'],
              ['Year', data.vehicle.year?.toString() ?? '—'],
              ['Owner', data.vehicle.ownerName ?? '—'],
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { text: '' },
      ] : []),
      { text: 'Card Reads', style: 'sectionHeader' },
      {
        table: {
          headerRows: 1,
          body: [
            ['Date', 'Card Type', 'Serial', 'Status'],
            ...data.cardReads.map((r) => [
              r.createdAt,
              r.cardType,
              r.cardSerial,
              r.readStatus,
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
    ],
    styles: {
      header:        { fontSize: 18, bold: true, margin: [0, 0, 0, 8] },
      subheader:     { fontSize: 10, color: '#666', margin: [0, 0, 0, 4] },
      sectionHeader: { fontSize: 13, bold: true, margin: [0, 12, 0, 4] },
    },
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
  };

  const printer = new PdfPrinter(fonts);
  const pdfDoc = printer.createPdfKitDocument(docDef);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', resolve);
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  const s3Key = `${data.tenantId}/reports/${data.reportId}.pdf`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    Metadata: { tenantId: data.tenantId, reportId: data.reportId },
  }));

  log.info({ s3Key, sizeBytes: pdfBuffer.length }, 'PDF uploaded');
  return s3Key;
}

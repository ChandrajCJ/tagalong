import { z } from 'zod';

/** What a file is for. The app filters by these. */
export const DOCUMENT_KINDS = ['flight', 'stay', 'ticket', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** 25 MB. Big enough for a boarding pass or a photo of one, small enough to be quick. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** What people actually attach to a trip. Anything else is refused. */
export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'text/plain',
] as const;

export const TripDocument = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  uploadedBy: z.string().uuid(),
  uploaderName: z.string().nullable(),
  kind: z.enum(DOCUMENT_KINDS),
  name: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nullable(),
  status: z.enum(['pending', 'ready']),
  hasThumbnail: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type TripDocument = z.infer<typeof TripDocument>;

export const DocumentList = z.object({ documents: z.array(TripDocument) });

export const CreateDocumentInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Give the file a name').max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES, {
    errorMap: () => ({ message: 'That kind of file can’t be added yet' }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_DOCUMENT_BYTES, 'Files need to be 25 MB or smaller'),
  kind: z.enum(DOCUMENT_KINDS).default('other'),
});
export type CreateDocumentInput = z.input<typeof CreateDocumentInput>;

/** What the phone gets back: the row, plus where to send the bytes. */
export const DocumentUpload = z.object({
  document: TripDocument,
  uploadUrl: z.string().url(),
  /** Seconds the upload link stays valid. */
  expiresIn: z.number().int(),
});
export type DocumentUpload = z.infer<typeof DocumentUpload>;

export const UpdateDocumentInput = z.object({
  name: z.string().trim().min(1, 'Give the file a name').max(200).optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  version: z.number().int().min(1),
});
export type UpdateDocumentInput = z.input<typeof UpdateDocumentInput>;

/** A short-lived link to read the file. */
export const DocumentLink = z.object({ url: z.string().url(), expiresIn: z.number().int() });
export type DocumentLink = z.infer<typeof DocumentLink>;

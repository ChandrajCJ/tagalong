import {
  ALLOWED_CONTENT_TYPES,
  DocumentLink,
  DocumentUpload,
  MAX_DOCUMENT_BYTES,
  TripDocument,
  newId,
  type DocumentKind,
} from '@tagalong/shared';
import { ApiError, request } from './api';

export type Allowed = (typeof ALLOWED_CONTENT_TYPES)[number];

/** A file the user picked, in the shape the upload needs. */
export interface PickedFile {
  uri: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

/** What we show for each kind, and the order of the filter chips. */
export const DOCUMENT_KIND_META: Record<DocumentKind, { label: string; icon: string }> = {
  flight: { label: 'Flights', icon: 'send' },
  stay: { label: 'Stays', icon: 'home' },
  ticket: { label: 'Tickets', icon: 'tag' },
  other: { label: 'Other', icon: 'file' },
};

const isAllowed = (type: string): type is Allowed =>
  (ALLOWED_CONTENT_TYPES as readonly string[]).includes(type);

/** "application/pdf" → "PDF"; "image/jpeg" → "JPEG". */
export const typeLabel = (contentType: string) =>
  contentType.split('/')[1]?.toUpperCase().replace('X-', '') ?? 'FILE';

/** "1.2 MB", "840 KB". */
export const fileSize = (bytes: number | null) => {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Says why a file can't be added, or null when it's fine. */
export const rejectReason = (file: PickedFile): string | null => {
  if (!isAllowed(file.contentType)) {
    return `${typeLabel(file.contentType)} files can't be added yet. Try a PDF or a photo.`;
  }
  if (file.sizeBytes > MAX_DOCUMENT_BYTES) {
    return `That file is ${fileSize(file.sizeBytes)}. Files need to be 25 MB or smaller.`;
  }
  return null;
};

/**
 * The upload, in the three steps the API expects: ask for a link, send the
 * bytes straight to storage, then tell the API it landed. The file never
 * passes through our server.
 */
export const uploadDocument = async (
  tripId: string,
  file: PickedFile,
  kind: DocumentKind,
  id = newId(),
): Promise<TripDocument> => {
  const { document, uploadUrl } = await request(`/trips/${tripId}/documents`, {
    method: 'POST',
    body: {
      id,
      name: file.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      kind,
    },
    schema: DocumentUpload,
  });

  const body = await fetch(file.uri).then((r) => r.blob());
  const sent = await fetch(uploadUrl, {
    method: 'PUT',
    body,
    headers: { 'content-type': file.contentType },
  });
  if (!sent.ok) throw new ApiError(sent.status, 'upload_failed', "The file didn't upload. Try again.");

  return request(`/documents/${document.id}/complete`, { method: 'POST', schema: TripDocument });
};

/** A fresh short-lived link to open or share the file. */
export const documentUrl = (documentId: string) =>
  request(`/documents/${documentId}/url`, { schema: DocumentLink });

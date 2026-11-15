import { z } from 'zod';
import { uploadIntent } from '../services/cloudinaryService.js';

const uploadRequestSchema = z.object({ purpose: z.enum(['PRODUCT', 'STOREFRONT']) }).strict();

/** Signs one direct browser-to-Cloudinary upload; the file never passes through this server. */
export const createUploadIntent = (req, res, next) => {
  try {
    const { purpose } = uploadRequestSchema.parse(req.body);
    res.set('Cache-Control', 'no-store').json(uploadIntent(purpose));
  } catch (error) { next(error); }
};

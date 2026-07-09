import { z } from 'zod';
import { sendContactEmail } from '../services/mailService.js';

const contactSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  message: z.string().min(10),
});

export const sendContactMessage = async (req, res, next) => {
  try {
    const data = contactSchema.parse(req.body);
    await sendContactEmail(data);

    res.json({ message: 'Message sent successfully' });
  } catch (error) {
    next(error);
  }
};

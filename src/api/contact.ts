import api from "./client";

export type ContactMessage = {
  name: string;
  email: string;
  phone?: string;
  message: string;
};

export const contactAPI = {
  send: (data: ContactMessage) => api.post("/contact", data),
};

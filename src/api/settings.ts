import api from "./client";
import type { AdminData } from "../store/StoreContext";
import type { ColorPreset } from "../store/CustomizeContext";

export type ThemeSettings = {
  fontId: string;
  colorId: string;
  customColors: ColorPreset;
};

const adminHeaders = () => {
  const token = localStorage.getItem("adminToken");
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

export const settingsAPI = {
  getAdminData: () => api.get<AdminData | null>("/settings/admin-data"),
  publishAdminData: (data: AdminData) => api.put<AdminData>("/settings/admin-data", data, adminHeaders()),
  getTheme: () => api.get<ThemeSettings | null>("/settings/theme"),
  publishTheme: (data: ThemeSettings) => api.put<ThemeSettings>("/settings/theme", data, adminHeaders()),
};

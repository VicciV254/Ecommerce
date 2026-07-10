import prisma from '../config/database.js';

const ADMIN_DATA_KEY = 'adminData';
const THEME_KEY = 'theme';

export const getAdminData = async (req, res, next) => {
  try {
    const setting = await prisma.siteSetting.findUnique({ where: { key: ADMIN_DATA_KEY } });
    res.json(setting?.value ?? null);
  } catch (error) {
    next(error);
  }
};

export const publishAdminData = async (req, res, next) => {
  try {
    const setting = await prisma.siteSetting.upsert({
      where: { key: ADMIN_DATA_KEY },
      create: { key: ADMIN_DATA_KEY, value: req.body },
      update: { value: req.body },
    });
    res.json(setting.value);
  } catch (error) {
    next(error);
  }
};

export const getTheme = async (req, res, next) => {
  try {
    const setting = await prisma.siteSetting.findUnique({ where: { key: THEME_KEY } });
    res.json(setting?.value ?? null);
  } catch (error) {
    next(error);
  }
};

export const publishTheme = async (req, res, next) => {
  try {
    const setting = await prisma.siteSetting.upsert({
      where: { key: THEME_KEY },
      create: { key: THEME_KEY, value: req.body },
      update: { value: req.body },
    });
    res.json(setting.value);
  } catch (error) {
    next(error);
  }
};

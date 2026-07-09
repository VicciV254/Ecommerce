import prisma from '../config/database.js';
import { designerSchema } from '../utils/validators.js';

export const getAllDesigners = async (req, res, next) => {
  try {
    const designers = await prisma.designer.findMany({
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    
    res.json(designers);
  } catch (error) {
    next(error);
  }
};

export const getDesignerById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const designer = await prisma.designer.findUnique({
      where: { id },
      include: {
        products: {
          where: { isActive: true },
          include: {
            category: true,
            stock: true,
            images: { orderBy: { order: 'asc' } },
          },
        },
      },
    });
    
    if (!designer) {
      return res.status(404).json({ error: 'Designer not found' });
    }
    
    res.json(designer);
  } catch (error) {
    next(error);
  }
};

export const createDesigner = async (req, res, next) => {
  try {
    const validatedData = designerSchema.parse(req.body);
    
    const designer = await prisma.designer.create({
      data: {
        designerId: validatedData.designerId,
        fullName: validatedData.fullName,
        specialty: validatedData.specialty,
        location: validatedData.location || 'Mombasa',
        profileImage: validatedData.profileImage,
        spotlightHeading: validatedData.spotlightHeading,
        spotlightText: validatedData.spotlightText,
      },
    });
    
    res.status(201).json(designer);
  } catch (error) {
    next(error);
  }
};

export const updateDesigner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const validatedData = designerSchema.parse(req.body);
    
    const designer = await prisma.designer.update({
      where: { id },
      data: {
        designerId: validatedData.designerId,
        fullName: validatedData.fullName,
        specialty: validatedData.specialty,
        location: validatedData.location,
        profileImage: validatedData.profileImage,
        spotlightHeading: validatedData.spotlightHeading,
        spotlightText: validatedData.spotlightText,
      },
    });
    
    res.json(designer);
  } catch (error) {
    next(error);
  }
};

export const deleteDesigner = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    await prisma.designer.delete({
      where: { id },
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

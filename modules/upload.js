const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const auth = require('./auth');

const router = express.Router();
const BUCKET = 'media';
const ALLOWED_TYPES = new Set(['image', 'audio', 'video']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 МБ
    files: 1,
    fields: 2,
  },
}).single('file');

router.post(
  '/',
  auth.authMiddleware(['editor', 'admin']),
  (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) return next();

      if (error instanceof multer.MulterError) {
        return res.status(400).json({
          error: 'Ошибка загрузки: проверьте размер и количество файлов',
        });
      }

      next(error);
    });
  },
  async (req, res, next) => {
    try {
      const region_name = req.body?.region_name?.trim();
      const type = req.body?.type?.trim();
      const file = req.file;

      if (
        !file ||
        !region_name ||
        region_name.length > 200 ||
        !ALLOWED_TYPES.has(type)
      ) {
        return res.status(400).json({
          error: 'Нужны file, region_name и type (image, audio или video)',
        });
      }

      if (!file.mimetype.startsWith(`${type}/`)) {
        return res.status(400).json({
          error: 'Тип файла не соответствует полю type',
        });
      }

      // В имени файла не используем исходное имя и название региона.
      const originalExt = path.extname(file.originalname).toLowerCase();
      const safeExt = /^\.[a-z0-9]{1,10}$/.test(originalExt)
        ? originalExt
        : '';

      const file_path = `${type}/${randomUUID()}${safeExt}`;
      const storage = auth.supabase.storage.from(BUCKET);

      const { error: uploadError } = await storage.upload(
        file_path,
        file.buffer,
        {
          contentType: file.mimetype,
          upsert: false,
        }
      );

      if (uploadError) throw uploadError;

      const { data: publicData } = storage.getPublicUrl(file_path);

      const { data, error: dbError } = await auth.supabase
        .from('media')
        .insert({
          region_name,
          type,
          file_path,
          url: publicData.publicUrl,
        })
        .select('id, region_name, type, file_path, url, created_at')
        .single();

      if (dbError) {
        // Не оставляем файл в Storage, если запись в БД не создалась.
        try {
          const { error: cleanupError } = await storage.remove([file_path]);
          if (cleanupError) console.error('Ошибка очистки Storage:', cleanupError);
        } catch (cleanupError) {
          console.error('Ошибка очистки Storage:', cleanupError);
        }

        throw dbError;
      }

      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:region', async (req, res, next) => {
  try {
    const { data, error } = await auth.supabase
      .from('media')
      .select('id, region_name, type, file_path, url, created_at')
      .eq('region_name', req.params.region)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    next(error);
  }
});

router.delete(
  '/:id',
  auth.authMiddleware(['admin']),
  async (req, res, next) => {
    try {
      const { data: media, error: lookupError } = await auth.supabase
        .from('media')
        .select('id, file_path')
        .eq('id', req.params.id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (!media) {
        return res.status(404).json({ error: 'Медиа не найдено' });
      }

      const { error: storageError } = await auth.supabase.storage
        .from(BUCKET)
        .remove([media.file_path]);

      if (storageError) throw storageError;

      const { error: deleteError } = await auth.supabase
        .from('media')
        .delete()
        .eq('id', media.id);

      if (deleteError) throw deleteError;

      res.json({ message: 'Медиа удалено' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

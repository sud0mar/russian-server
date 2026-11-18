const express = require('express');
const multer = require('multer');
const path = require('node:path');
const auth = require('./auth');

const router = express.Router();
const BUCKET = 'media';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 20 МБ
    files: 1,
    fields: 6
  }
});

router.post('/', auth.authMiddleware(['admin', 'editor']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Нет файла' });

    const { region_name, type, caption } = req.body;
    if (!region_name || !type) return res.status(400).json({ error: 'Нужны region_name и type' });

    const bucket = process.env.SUPABASE_BUCKET || 'media';
    const safeName = req.file.originalname.replace(/[^\w.\-]/g, '_');
    
    const filePath = `${type}/${Date.now()}_${safeName}`;

    const { error: uploadErr } = await auth.supabase.storage
      .from(bucket)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
      
    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    const { data: urlData } = auth.supabase.storage.from(bucket).getPublicUrl(filePath);
    const url = urlData.publicUrl;

    const { error: dbErr } = await auth.supabase.from('media').insert({
      region_name,
      type,
      filename: safeName,
      url,
      caption: caption || '',
      uploaded_by: req.user.username,
      file_path: filePath // <-- ДОБАВЛЕНА ЭТА СТРОКА
    });
    
    if (dbErr) return res.status(500).json({ error: dbErr.message });

    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:region', async (req, res) => {
  const region = decodeURIComponent(req.params.region);
  const { data, error } = await auth.supabase
    .from('media')
    .select('*')
    .eq('region_name', region)
    .order('uploaded_at', { ascending: false });
    
  if (error) return res.status(500).json({ error: error.message });

  const formattedData = (data || []).map(item => ({
    ...item,
    publicUrl: item.url 
  }));

  res.json(formattedData);
});

router.delete('/:id', auth.authMiddleware(['admin']), async (req, res, next) => {
  try {
    // 1. Добавляем объявление bucket, которого не хватало
    const bucket = process.env.SUPABASE_BUCKET || 'media'; 

    const { data: media, error: lookupError } = await auth.supabase
      .from('media')
      .select('id, url, file_path')
      .eq('id', req.params.id)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!media) return res.status(404).json({ error: 'Медиа не найдено' });

    let pathToDelete = media.file_path;

    if (!pathToDelete && media.url) {
      const urlParts = media.url.split('/');
      const bucketIndex = urlParts.indexOf(bucket);
      if (bucketIndex !== -1) {
        pathToDelete = urlParts.slice(bucketIndex + 1).join('/');
      }
    }

    if (pathToDelete) {
      const { error: storageError } = await auth.supabase.storage
        .from(bucket) // Теперь bucket определена!
        .remove([pathToDelete]);
      
      if (storageError) {
        console.warn('Не удалось удалить файл из Storage:', storageError.message);
      }
    }

    const { error: deleteError } = await auth.supabase
      .from('media')
      .delete()
      .eq('id', media.id);

    if (deleteError) throw deleteError;

    res.json({ message: 'Медиа удалено' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
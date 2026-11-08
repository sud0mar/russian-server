const express = require('express');
const multer = require('multer');
const path = require('node:path');
const auth = require('./auth');

const router = express.Router();
const BUCKET = 'media';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 МБ
    files: 1,
    fields: 2
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
      uploaded_by: req.user.username
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
    const { data: media, error: lookupError } = await auth.supabase
      .from('media')
      .select('id, url')
      .eq('id', req.params.id)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (!media) {
      return res.status(404).json({ error: 'Медиа не найдено' });
    }

    const urlParts = media.url.split('/');
    const filePathForDelete = urlParts.slice(urlParts.indexOf(bucket) + 1).join('/');

    const { error: storageError } = await auth.supabase.storage
      .from(bucket)
      .remove([filePathForDelete]);

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
});

module.exports = router;
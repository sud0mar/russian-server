const express = require('express');
const auth = require('./auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await auth.supabase
      .from('regions')
      .select('name, history, facts, phrases, dialects')
      .order('name');

    if (error) throw error;

    const regions = Object.fromEntries(
      (data || []).map((region) => [
        region.name,
        {
          history: region.history,
          facts: region.facts,
          phrases: region.phrases,
          dialects: region.dialects,
        },
      ])
    );

    res.json(regions);
  } catch (error) {
    next(error);
  }
});
 
// Маршрут для получения данных ОДНОГО конкретного региона
router.get('/:name', async (req, res, next) => {
  try {
    const regionName = req.params.name; // Получаем название из URL

    const { data, error } = await auth.supabase
      .from('regions')
      .select('name, history, facts, phrases, dialects')
      .eq('name', regionName) // Ищем именно этот регион
      .maybeSingle();

    if (error) throw error;

    // Если регион не найден, отдаем пустые поля
    if (!data) {
      return res.json({ 
        history: '', 
        facts: '', 
        phrases: '', 
        dialects: '' 
      });
    }

    // Если нашли — отдаем текст
    res.json({
      history: data.history || '',
      facts: data.facts || '',
      phrases: data.phrases || '',
      dialects: data.dialects || ''
    });

  } catch (error) {
    next(error);
  }
});


router.post(
  '/:name',
  auth.authMiddleware(['editor', 'admin']),
  async (req, res, next) => {
    try {
      const name = req.params.name.trim();
      const { history, facts, phrases, dialects } = req.body || {};

      if (!name || name.length > 200) {
        return res.status(400).json({ error: 'Некорректное название региона' });
      }

      if (![history, facts, phrases, dialects].every((value) =>
        typeof value === 'string' || value === undefined
      )) {
        return res.status(400).json({
          error: 'history, facts, phrases, dialects должны быть строками',
        });
      }

      const { data, error } = await auth.supabase
        .from('regions')
        .upsert(
          {
            name,
            history: history || '',
            facts: facts || '',
            phrases: phrases || '',
            dialects: dialects || '',
          },
          { onConflict: 'name' }
        )
        .select('name, history, facts, phrases, dialects')
        .single();

      if (error) throw error;

      res.json(data);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
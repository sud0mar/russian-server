const express = require('express');
const auth = require('./auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await auth.supabase
      .from('regions')
      .select('name, history, facts, phrases')
      .order('name');

    if (error) throw error;

    const regions = Object.fromEntries(
      (data || []).map((region) => [
        region.name,
        {
          history: region.history,
          facts: region.facts,
          phrases: region.phrases,
        },
      ])
    );

    res.json(regions);
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
      const { history, facts, phrases } = req.body || {};

      if (!name || name.length > 200) {
        return res.status(400).json({ error: 'Некорректное название региона' });
      }

      if (![history, facts, phrases].every((value) =>
        typeof value === 'string'
      )) {
        return res.status(400).json({
          error: 'history, facts и phrases должны быть строками',
        });
      }

      const { data, error } = await auth.supabase
        .from('regions')
        .upsert(
          { name, history, facts, phrases },
          { onConflict: 'name' }
        )
        .select('name, history, facts, phrases')
        .single();

      if (error) throw error;

      res.json(data);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

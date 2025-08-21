const express = require('express')
const {askNews,debugCollection,healthCollection} = require('../controllers/newsController')

const router = express.Router()
router.post('/query',askNews)
router.get('/debug/collection',debugCollection)
router.get('/health',healthCollection)

module.exports = router
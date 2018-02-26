const express = require('express')
const router = express.Router()
const pkg = require('../package.json')

// list current agents for current user
router.get('/', function (req, res) {
  res.status(200).send({
    version: pkg.version
  })
})

module.exports = router

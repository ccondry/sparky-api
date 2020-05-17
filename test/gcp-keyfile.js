// Load our environment variables
require('dotenv').config()
// connect to database, log any errors
const db = require('../src/models/db')
const fs = require('fs')
const keyfile = fs.readFileSync('./credentials/cumulus-v2-hotikl-e942c76ea50b.json', 'utf8')
console.log(keyfile)
const credentials = JSON.parse(keyfile)
db.insertOne('toolbox', 'credentials', credentials)
.then(r => console.log('credentials saved to mongo.'))
.catch(e => console.error('failed to save credentials to mongo:', e))

// connect to database, log any errors
const db = require('./db')

module.exports = {
  get (project_id) {
    // get GCP credentials JSON from database, key on project_id
    const query = {
      project_id
    }
    return db.findOne('toolbox', 'credentials', query)
  },
  set (credentials) {
    // update or insert GCP credentials JSON into database, key on project_id
    const query = {
      project_id: credentials.project_id
    }
    return db.upsert('toolbox', 'credentials', query, credentials)
  }
}

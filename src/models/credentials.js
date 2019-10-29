// connect to database, log any errors
const db = require('./db')

module.exports = {
  async get (project_id) {
    if (!project_id || !project_id.length) {
      throw new Error('GCP project ID required to retrieve credentials but was not provided.')
    }
    // trim whitespace off
    project_id = project_id.trim()
    // get GCP credentials JSON from database, key on project_id
    const query = {
      project_id
    }
    const results = await db.findOne('toolbox', 'credentials', query)
    if (!results) {
      throw new Error('GCP project ID', project_id, 'did not have matching credentials in the database.')
    }
  },
  async set (credentials) {
    if (!credentials || !credentials.project_id || !credentials.project_id.length) {
      throw new Error('GCP credentials must contain a project_id property.')
    }
    // update or insert GCP credentials JSON into database, key on project_id
    const query = {
      project_id: credentials.project_id
    }
    return db.upsert('toolbox', 'credentials', query, credentials)
  }
}

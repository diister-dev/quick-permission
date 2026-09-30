// I want to check if I can update an user
// I need:
// - The user id
// - Who is making the request
// I need to check:
// - If the requester is the user itself
// - If the requester have a permission to update the user

// I want to check if I can comment on an article
// I need:
// - The article id
// - Who is making the request
// I need to check:
// - If the requester is the author of the article
//   - I need to get the article author id
// - If the requester has permission to comment on the article

// Constraint
// - The server can see the entire state of the system
// - The server can check any permission of the user, and get context if necessary
// - The user can only see a subset of the state of the system
// - The user cannot always check permissions locally, it needs to make the action to the server
//    - Maybe introduce a "no_enough_context" error, information, to let the user make the request to the server


const hierarchy ={
  user: {
    CREATE: true,
    ":userId": {
      READ: true,
      UPDATE: true,
      DELETE: false,
    }
  },
  drive: {
    CREATE: true, // Need: permission
    "[driveId]": {
      READ: true, // Need: permission, drive owner
      UPDATE: true, // Need: permission, drive owner
      DELETE: false, // Need: permission, drive owner
      folder: {
        CREATE: true, // Need: permission, drive owner
        "[folderId]": {
          READ: true, // Need: permission, drive owner, folder owner, folder parents
          UPDATE: true, // Need: permission, drive owner, folder owner, folder parents
          DELETE: false, // Need: permission, drive owner, folder owner, folder parents
          file: {
            CREATE: true, // Need: permission, drive owner, folder owner, folder parents
            "[fileId]": {
              READ: true, // Need: permission, drive owner, folder owner, file owner, folder parent, folder parents
              UPDATE: true, // Need: permission, drive owner, folder owner, file owner, folder parent, folder parents
              DELETE: false // Need: permission, drive owner, folder owner, file owner, folder parent, folder parents
            }
          }
        }
      }
    }
  }
}

const states = [
  { key: "drive.[driveId].READ", driveId: "drive:0" }, // Only access to drive:0, but not content
  { key: "drive.[driveId]", driveId: "drive:0" }, // Not a node, but a path, but if defined, the path can be an intermediate state
  { key: "drive.[driveId].folder.[folderId].READ", driveId: "drive:0", folderId: "folder:0" }, // Only access to folder:0 in drive:0
  { key: "drive.[driveId].folder.[folderId].READ", driveId: "drive:0", folderId: "folder:*" }, // Access to all folders in drive:0
]
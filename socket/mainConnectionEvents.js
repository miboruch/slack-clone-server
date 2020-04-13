const namespaceController = require('../controllers/NamespaceController');
const userController = require('../controllers/UserController');
const namespaceModule = require('../modules/namespacesModule');

const mainConnectionEvents = async socket => {
  /* send namespaces to the client */
  socket.emit(
    'load_namespaces',
    await namespaceController.getAllUserNamespaces(socket.decoded._id)
  );

  /* Create new namespace */
  socket.on(
    'create_namespace',
    async ({ name, ownerID, isPrivate, password, color }) => {
      console.log(name, ownerID, isPrivate, color);
      const namespace = await namespaceController.createNewNamespace(
        name,
        ownerID,
        isPrivate,
        password,
        color
      );

      socket.emit('namespace_created', namespace);
    }
  );

  socket.on('search_namespace_by_id', async namespaceID => {
    const namespace = await namespaceController.getNamespaceData(namespaceID);
    socket.emit('namespace_search_finished', namespace);
  });

  socket.on('search_namespace_by_name', async namespaceName => {
    const namespaces = await namespaceController.getNamespacesByName(
      namespaceName
    );
    socket.emit('namespace_search_finished', namespaces);
  });

  /* Join to the main room */
  socket.on('join_namespace', (userID, namespace) => {
    /* update user object - User.namespaces -> push joined namespace */
    userController.addNamespaceToUser(userID, namespace);
  });

  /* Disconnect */
  socket.on('disconnect', () => {
    console.log('DISCONNECTING');
  });
};

module.exports = mainConnectionEvents;

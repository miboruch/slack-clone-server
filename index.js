const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const socket = require('./socket');
const namespaceController = require('./controllers/NamespaceController');
const roomController = require('./controllers/RoomController');
const socketAuthentication = require('./socket/socketAuthentication');
require('dotenv').config();
const mainConnectionEvents = require('./socket/mainConnectionEvents');

const userRoutes = require('./routes/userRoutes');

/* MIDDLEWARES */
const app = express();
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, auth-token'
  );
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  next();
});

const usersOnline = [];

mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true });

const connection = mongoose.connection;
connection.on('error', error => {
  console.log('Connection error' + error);
});

/* Database connection */
connection.once('open', async () => {
  console.log('Connected to DB');
  const server = app.listen(9000);
  const io = socket.init(server);

  /* Socket with token authentication */
  io.use((socket, next) => {
    socketAuthentication(socket, next);
  }).on('connection', async socket => {
    await mainConnectionEvents(socket);
  });

  const rooms = await roomController.getAllRooms();
  const allRooms = rooms.map(room => {
    return { id: room._id.toString(), users: [] };
  });

  /* Add user to rooms array */
  const addToRoom = (roomID, userID) => {
    const room = allRooms.find(item => item.id === roomID);
    const index = allRooms.indexOf(room);

    if (room.users.filter(user => user === userID).length === 0) {
      allRooms[index].users.push(userID);
    }

    return allRooms[index].users.length;
  };

  /* Remove user from rooms array */
  const removeFromRoom = (roomID, userID) => {
    console.log(`REMOVE REQUEST ROOM ID: ${roomID} USER ID: ${userID}`);
    const room = allRooms.find(item => item.id === roomID);

    const index = allRooms.indexOf(room);

    allRooms[index].users = allRooms[index].users.filter(
      user => user !== userID
    );

    return allRooms[index].users.length;
  };

  const namespaceUsers = [];
  /* namespace socket with authentication */
  namespaceController
    .getAllNamespaces()
    .then(namespaces =>
      namespaces.map(item => {
        io.of(`/${item._id}`)
          .use((namespaceSocket, next) => {
            socketAuthentication(namespaceSocket, next);
          })
          .on('connection', async namespaceSocket => {
            const currentNamespace = io.of(`/${item._id}`);

            /* store in online users array */
            if (
              namespaceUsers.filter(
                user => user.userID === namespaceSocket.decoded._id
              ).length === 0
            ) {
              namespaceUsers.push({
                socketID: namespaceSocket.id,
                userID: namespaceSocket.decoded._id
              });
            }

            namespaceSocket.emit('namespace_joined', item._id);

            /* load rooms */
            namespaceSocket.emit(
              'load_rooms',
              await roomController.getAllNamespaceRooms(item._id)
            );

            /* get namespace data */
            namespaceSocket.emit(
              'namespace_data',
              await namespaceController.getNamespaceData(item._id)
            );

            /* create room */
            namespaceSocket.on('create_room', async ({ name, description }) => {
              const savedRoom = await roomController.createNewRoom(
                name,
                description,
                item._id
              );

              allRooms.push({
                id: savedRoom._id.toString(),
                users: [namespaceSocket.decoded._id]
              });

              /* emit to everyone in the namespace */
              currentNamespace.emit('room_created', savedRoom);
              namespaceSocket.join(savedRoom._id);
              namespaceSocket.emit('user_joined', savedRoom._id.toString());
            });

            /* LEAVE ROOM */
            namespaceSocket.on('leave_room', roomID => {
              removeFromRoom(roomID, namespaceSocket.decoded._id);
              namespaceSocket.leave(roomID);
              const currentRoom = allRooms.find(room => (room.id = roomID));

              currentNamespace
                .to(roomID)
                .emit('members_update', currentRoom.users.length);

              // currentNamespace.in(roomID).clients((error, clients) => {
              //   currentNamespace
              //       .in(roomID)
              //       .emit('members_update', clients.length);
              // });
              namespaceSocket.emit('user_left', {
                roomID: roomID
              });
              console.log('--------');
              console.log('ON LEAVE ROOMS STATE');
              console.log(allRooms);

              namespaceSocket.emit('user_left', {
                roomID: roomID
              });

              currentNamespace
                .to(roomID)
                .emit('members_update', currentRoom.users.length);
            });

            /* JOIN ROOM */
            namespaceSocket.on('join_room', async roomID => {
              const roomMembers = addToRoom(
                roomID,
                namespaceSocket.decoded._id
              );

              namespaceSocket.join(roomID);

              const [currentRoomInfo] = await roomController.getSingleRoomInfo(
                roomID
              );

              currentNamespace.in(roomID).clients((error, clients) => {
                currentNamespace
                  .in(roomID)
                  .emit('members_update', clients.length);
              });

              namespaceSocket.emit('user_joined', {
                room: currentRoomInfo
              });

              // currentNamespace.to(roomID).emit('members_update', roomMembers);

              namespaceSocket.emit('new_message', 'Welcome in new room');

              namespaceSocket
                .in(roomID)
                .emit('history_catchup', `THIS IS HISTORY OF ROOM ${roomID}`);
            });

            /* SEND RECEIVED MESSAGE */
            namespaceSocket.on('send_message', ({ message, room }) => {
              /* save message to db */
              currentNamespace.to(room).emit('new_message', message);
            });

            namespaceSocket.on('disconnect', () => {
              usersOnline.filter(
                user => user.userID !== namespaceSocket.decoded._id
              );
              console.log('disconnected');
            });
          });
      })
    )
    .catch(error => console.log(error));

  app.use('/user', userRoutes);
});

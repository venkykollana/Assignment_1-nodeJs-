const express = require("express");
const bcrypt = require("bcrypt");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const path = require("path");

const dbpath = path.join(__dirname, "twitterClone.db");

const app = express();
app.use(express.json());

let db = null;
const initializeServerAndDatabase = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running on http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeServerAndDatabase();

//API-1 (register_user)
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const searchUserQuery = `
    SELECT * 
    FROM user
    WHERE username = '${username}';`;
  const searchUser = await db.get(searchUserQuery);
  if (searchUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
        INSERT INTO user(name, username, password, gender)
        VALUES('${name}', '${username}', '${hashedPassword}', '${gender}');`;
      const createdUser = await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//check login details
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const searchUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const dbUser = await db.get(searchUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const passwordMatched = await bcrypt.compare(password, dbUser.password);
    if (passwordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//API-3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQuery = `
    SELECT 
        username, tweet, date_time AS dateTime
    FROM
        (follower INNER JOIN tweet 
        ON follower.following_user_id = tweet.user_id) AS T
        INNER JOIN user ON T.follower_user_id = user.user_id
    WHERE user.username = '${username}'
    ORDER BY date_time DESC
    LIMIT 4; 
    `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//API-4(following_list)
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getFollowingUsersListQuery = `
    SELECT 
        name
    FROM
        user
    WHERE user_id IN (SELECT 
                            following_user_id
                        FROM 
                            user
                        INNER JOIN
                            follower
                        ON user.user_id = follower.follower_user_id 
                        WHERE 
                            user.username = '${username}');`;
  const followingUsers = await db.all(getFollowingUsersListQuery);
  response.send(followingUsers);
});

//API-5(followers_list)
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getFollowingUsersListQuery = `
    SELECT 
        name
    FROM
        user
    WHERE user_id IN (SELECT 
                            follower_user_id
                        FROM 
                            user
                        INNER JOIN
                            follower
                        ON user.user_id = follower.following_user_id 
                        WHERE 
                            user.username = '${username}');`;
  const followerUsers = await db.all(getFollowingUsersListQuery);
  response.send(followerUsers);
});

//API-6
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const getTweetDetailsQuery = `
  SELECT 
        tweet,
        COUNT(like_id) AS likes,
        COUNT(reply_id) AS replies,
        date_time AS dateTime
  FROM 
        (tweet 
        INNER JOIN reply ON tweet.tweet_id = reply.tweet_id) AS T 
        INNER JOIN like ON T.tweet_id = like.tweet_id 
  WHERE
        tweet.user_id IN (
                            SELECT 
                                following_user_id
                            FROM 
                                follower 
                                INNER JOIN user
                                ON follower.follower_user_id=user.user_id 
                            WHERE 
                                user.username='${username}') AND tweet.tweet_id = ${tweetId};
        `;
  const tweetDetails = await db.get(getTweetDetailsQuery);
  if (tweetDetails["tweet"] === null) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(tweetDetails);
  }
});

//API-7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getTweetDetailsQuery = `
  SELECT 
        username
  FROM 
        (user
        NATURAL JOIN like) AS T
        INNER JOIN tweet ON T.tweet_id = tweet.tweet_id
  WHERE 
        like.tweet_id = ${tweetId} AND tweet.user_id IN (
                                        SELECT 
                                            following_user_id
                                        FROM 
                                            follower 
                                            INNER JOIN user
                                            ON follower.follower_user_id=user.user_id 
                                        WHERE 
                                            user.username='${username}'

        );

        `;
    const tweetDetails = await db.all(getTweetDetailsQuery);
    const reqUserDetails = tweetDetails.map((eachObj) => eachObj.username);
    if (tweetDetails.username === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({
        likes: reqUserDetails,
      });
    }
  }
);

const createReplyAndName = (obj) => {
  return {
    name: obj.name,
    reply: obj.reply,
  };
};

//API-8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getTweetDetailsQuery = `
  SELECT 
        name,reply
  FROM 
        (user
        NATURAL JOIN reply) AS T
        INNER JOIN tweet ON T.tweet_id = tweet.tweet_id
  WHERE 
        reply.tweet_id = ${tweetId} AND tweet.user_id IN (
                                        SELECT 
                                            following_user_id
                                        FROM 
                                            follower 
                                            INNER JOIN user
                                            ON follower.follower_user_id=user.user_id 
                                        WHERE 
                                            user.username='${username}'

        );

        `;
    const tweetDetails = await db.all(getTweetDetailsQuery);
    const reqUserDetails = tweetDetails.map((eachObj) =>
      createReplyAndName(eachObj)
    );
    if (tweetDetails === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({
        replies: reqUserDetails,
      });
    }
  }
);

//API-9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetDetailsQuery = `
  SELECT 
        tweet,
        COUNT(like_id) AS likes,
        COUNT(reply_id) AS replies,
        date_time AS dateTime
  FROM 
        (tweet 
        INNER JOIN reply ON tweet.tweet_id = reply.tweet_id) AS T 
        INNER JOIN like ON T.tweet_id = like.tweet_id 
  WHERE
        tweet.user_id IN (
                            SELECT 
                                user_id
                            FROM 
                                user
                            WHERE 
                                username='${username}');
        `;
  const tweetDetails = await db.all(getTweetDetailsQuery);
  response.send(tweetDetails);
});

//API-10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const createTweetQuery = `
    INSERT INTO tweet(tweet, user_id,date_time)
    VALUES ('${tweet}', (SELECT user_id FROM user WHERE username = '${username}'), '${new Date()}');`;
  const tweetDetails = await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//API-11
app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const deleteQuery = `
    DELETE FROM tweet
    WHERE tweet_id = ${tweetId} AND user_id = (SELECT user_id FROM user WHERE username = '${username}')
    `;
  const deletedTweet = await db.run(deleteQuery);
  if (deletedTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send("Tweet Removed");
  }
});

module.exports = app;

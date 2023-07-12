import {
  $query,
  $update,
  Record,
  StableBTreeMap,
  Vec,
  match,
  Result,
  nat64,
  ic,
  Opt,
  Principal,
} from "azle";
import { v4 as uuidv4 } from "uuid";

// Define the Post type
type Post = Record<{
  id: string; // Unique identifier for the post
  title: string; // Title of the post
  body: string; // Body/content of the post
  image: string; // URL of the post's image
  owner: Principal; // Owner of the post
  likes: number; // Number of likes the post has
  createdAt: nat64; // Timestamp of when the post was created
  updatedAt: Opt<nat64>; // Optional timestamp of when the post was last updated
  comments: Vec<string>; // Array of comment IDs associated with the post
}>;

// Define the PostPayload type for creating and updating posts
type PostPayload = Record<{
  title: string; // Title of the post
  body: string; // Body/content of the post
  image: string; // URL of the post's image
}>;

// Define the Comment type
type Comment = Record<{
  id: string; // Unique identifier for the comment
  content: string; // Content of the comment
  sender: Principal; // Sender of the comment
  postId: string; // ID of the post to which the comment belongs
}>;

// Define the CommentPayload type for creating comments
type CommentPayload = Record<{
  content: string; // Content of the comment
  postId: string; // ID of the post to which the comment belongs
}>;

// Create new StableBTreeMaps to store posts and comments
const postStorage = new StableBTreeMap<string, Post>(0, 44, 1024);
const commentStorage = new StableBTreeMap<string, Comment>(1, 44, 1024);

$query;
// Retrieve all posts
export function getPosts(): Result<Vec<Post>, string> {
  return Result.Ok(postStorage.values());
}

$query;
// Retrieve a specific post by ID
export function getPost(id: string): Result<Post, string> {
  return match(postStorage.get(id), {
    Some: (post: Post) => Result.Ok<Post, string>(post),
    None: () => Result.Err<Post, string>(`A post with id=${id} was not found.`),
  });
}

$update;
// Create a new post
export function createPost(payload: PostPayload): Result<Post, string> {
  const post: Post = {
    id: uuidv4(), // Generate a unique ID for the new post
    createdAt: ic.time(), // Set the creation timestamp to the current time
    updatedAt: Opt.None, // Set the initial update timestamp as None
    owner: ic.caller(), // Set the owner of the post as the current caller
    likes: 0, // Initialize the number of likes to 0
    comments: [], // Initialize the comments array as empty
    ...payload,
  };

  postStorage.insert(post.id, post); // Store the post in the post storage
  return Result.Ok(post);
}

$update;
// Update an existing post
export function updatePost(
  id: string,
  payload: PostPayload
): Result<Post, string> {
  return match(postStorage.get(id), {
    Some: (post: Post) => {
      if (post.owner.toString() !== ic.caller().toString()) {
        return Result.Err<Post, string>(
          "You do not have permission to update this post."
        );
      }

      const updatedPost: Post = {
        ...post,
        ...payload,
        updatedAt: Opt.Some(ic.time()), // Set the update timestamp to the current time
      };
      postStorage.insert(post.id, updatedPost); // Update the post in the post storage
      return Result.Ok<Post, string>(updatedPost);
    },
    None: () =>
      Result.Err<Post, string>(
        `Couldn't update a post with id=${id}. Post not found.`
      ),
  });
}

$update;
// Like a post
export function likePost(postId: string): Result<Post, string> {
  return match(postStorage.get(postId), {
    Some: (post: Post) => {
      post.likes++; // Increment the number of likes for the post
      postStorage.insert(post.id, post); // Update the post in the post storage
      return Result.Ok<Post, string>(post);
    },
    None: () =>
      Result.Err<Post, string>(`A post with id=${postId} was not found.`),
  });
}

$query;
// Retrieve comments for a specific post
export function getCommentsOnPost(
  postId: string
): Result<Vec<Comment>, string> {
  return match(postStorage.get(postId), {
    Some: (post: Post) => {
      const comments: Comment[] = [];
      for (const commentId of post.comments) {
        match(commentStorage.get(commentId), {
          Some: (comment: Comment) => {
            comments.push(comment);
          },
          None: () => {},
        });
      }

      return Result.Ok<Comment[], string>(comments);
    },
    None: () => {
      return Result.Err<Comment[], string>(
        `A post with id=${postId} was not found.`
      );
    },
  });
}

$update;
// Add a comment to a post
export function commentOnPost(
  payload: CommentPayload
): Result<Comment, string> {
  return match(postStorage.get(payload.postId), {
    Some: (post: Post) => {
      const comment = { id: uuidv4(), sender: ic.caller(), ...payload };
      post.comments.push(comment.id); // Add the comment ID to the post's comments array
      commentStorage.insert(comment.id, comment); // Store the comment in the comment storage
      postStorage.insert(post.id, post); // Update the post in the post storage

      return Result.Ok<Comment, string>(comment);
    },
    None: () => {
      return Result.Err<Comment, string>(
        `A post with id=${payload.postId} was not found.`
      );
    },
  });
}

$update;
// Delete a comment
export function deleteComment(id: string): Result<Comment, string> {
  return match(commentStorage.get(id), {
    Some: (comment: Comment) => {
      if (comment.sender.toString() !== ic.caller().toString()) {
        return Result.Err<Comment, string>(
          `You do not have permission to delete this comment.`
        );
      }
      match(postStorage.get(comment.postId), {
        Some: (post: Post) => {
          const index = Array.from(post.comments).indexOf(id);
          if (index > -1) {
            post.comments.splice(index, 1); // Remove the comment ID from the post's comments array
          }
        },
        None: () => {},
      });
      commentStorage.remove(id); // Remove the comment from the comment storage
      return Result.Ok<Comment, string>(comment);
    },
    None: () => {
      return Result.Err<Comment, string>(
        `Couldn't delete a comment with id=${id}. Comment not found.`
      );
    },
  });
}

$update;
// Delete a post
export function deletePost(id: string): Result<Post, string> {
  return match(postStorage.get(id), {
    Some: (post: Post) => {
      if (post.owner.toString() !== ic.caller().toString()) {
        return Result.Err<Post, string>(
          `You do not have permission to delete this post.`
        );
      }
      const comments = commentStorage.values();
      for (const comment of comments) {
        if (comment.postId === id) {
          commentStorage.remove(comment.id); // Remove the comments associated with the post
        }
      }
      postStorage.remove(id); // Remove the post from the post storage
      return Result.Ok<Post, string>(post);
    },
    None: () => {
      return Result.Err<Post, string>(
        `Couldn't delete a post with id=${id}. Post not found.`
      );
    },
  });
}

// A workaround to make the uuid package work with Azle
globalThis.crypto = {
  getRandomValues: () => {
    let array = new Uint8Array(32);

    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }

    return array;
  },
};

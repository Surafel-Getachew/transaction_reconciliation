import { nanoid } from "nanoid";
import { IIdGenerator } from "../../domain/ids/id-generator.interface.js";

export const nanoIdGenerator: IIdGenerator = {
  generate: () => nanoid(),
};

import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema(
        {
                endpoint: { type: String, required: true },
                keys: {
                        p256dh: { type: String, required: true },
                        auth: { type: String, required: true },
                },
                expirationTime: { type: Number, default: null },
        },
        { _id: false }
);

const userSchema = new mongoose.Schema({
        email: {type:String, required:true, unique: true},
        fullName: {type: String , required: true},
        password: {type:String, required:true , minlength: 6},
        profilePic: {type:String,default: ""},
        profilePicPublicId: { type: String, default: "", select: false },
        profilePicResourceType: { type: String, default: "image", select: false },
        bio: {type:String},
        lastSeen: { type: Date, default: null },
        blockedUsers: {
                type: [
                        {
                                type: mongoose.Schema.Types.ObjectId,
                                ref: "User",
                        },
                ],
                default: [],
        },
        twoFactorEnabled: { type: Boolean, default: false },
        twoFactorSecret: { type: String, default: "", select: false },
        twoFactorTempSecret: { type: String, default: "", select: false },
        twoFactorEnabledAt: { type: Date, default: null },
        pushSubscriptions: { type: [pushSubscriptionSchema], default: [], select: false },
}, {timestamps: true})

userSchema.index({ blockedUsers: 1 });

const User = mongoose.model("User" , userSchema);

export default User;
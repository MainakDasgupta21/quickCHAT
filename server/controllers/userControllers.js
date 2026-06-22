import mongoose from "mongoose";
import { clearAuthCookie, generateToken, setAuthCookie } from "../lib/utils.js";
import User from "../models/User.js";
import bcrypt from 'bcryptjs'
import jwt from "jsonwebtoken";
import {
        generateSecret as generateTotpSecret,
        generateURI as generateTotpUri,
        verify as verifyTotpToken,
} from "otplib";
import QRCode from "qrcode";
import {
        destroyCloudinaryAsset,
        uploadBase64ToCloudinary,
} from "../lib/cloudinary.js"

const TWO_FACTOR_LOGIN_PURPOSE = "2fa-login";
const TWO_FACTOR_LOGIN_TTL_SECONDS = Math.max(
        60,
        Number(process.env.TWO_FACTOR_LOGIN_TTL_SECONDS || 300)
);
const TWO_FACTOR_ISSUER = process.env.TOTP_ISSUER || "quickCHAT";

// Never leak the bcrypt password hash back to the client. Signup/login used to
// respond with the raw Mongoose document, which included `password`.
const sanitizeUser = (user) => {
        if (!user) return user;
        const plain = typeof user.toObject === "function" ? user.toObject() : { ...user };
        delete plain.password;
        delete plain.pushSubscriptions;
        delete plain.profilePicPublicId;
        delete plain.profilePicResourceType;
        delete plain.twoFactorSecret;
        delete plain.twoFactorTempSecret;
        return plain;
};

const BLOCKED_USER_PUBLIC_FIELDS = "_id fullName profilePic bio lastSeen";
const toNormalizedId = (value) => String(value?._id || value || "").trim();
const toNormalizedTotpCode = (value) =>
        String(value || "")
                .trim()
                .replace(/[\s-]+/g, "");
const isValidTotpCodeFormat = (totpCode) => /^\d{6}$/.test(totpCode);
const isTotpCodeValid = async ({ token, secret }) => {
        if (!token || !secret) return false;
        try {
                const verificationResult = await verifyTotpToken({
                        strategy: "totp",
                        token,
                        secret,
                });
                return Boolean(verificationResult?.valid);
        } catch {
                return false;
        }
};

const createTwoFactorLoginToken = (userId) => {
        const normalizedUserId = toNormalizedId(userId);
        if (!normalizedUserId) return "";
        return jwt.sign(
                {
                        userId: normalizedUserId,
                        purpose: TWO_FACTOR_LOGIN_PURPOSE,
                },
                process.env.JWT_SECRET,
                { expiresIn: `${TWO_FACTOR_LOGIN_TTL_SECONDS}s` }
        );
};

const verifyTwoFactorLoginToken = (twoFactorToken) => {
        try {
                const decodedToken = jwt.verify(twoFactorToken, process.env.JWT_SECRET);
                if (decodedToken?.purpose !== TWO_FACTOR_LOGIN_PURPOSE) {
                        return null;
                }
                const normalizedUserId = toNormalizedId(decodedToken?.userId);
                return normalizedUserId || null;
        } catch {
                return null;
        }
};

const getBlockedUsersPayload = async (userId) => {
        const normalizedUserId = toNormalizedId(userId);
        if (!normalizedUserId || !mongoose.Types.ObjectId.isValid(normalizedUserId)) {
                return { blockedUserIds: [], blockedUsers: [] };
        }

        const userRecord = await User.findById(normalizedUserId)
                .select("blockedUsers")
                .lean();
        const blockedUserIds = Array.from(
                new Set(
                        (Array.isArray(userRecord?.blockedUsers) ? userRecord.blockedUsers : [])
                                .map((blockedUserId) => toNormalizedId(blockedUserId))
                                .filter(Boolean)
                )
        );

        if (!blockedUserIds.length) {
                return { blockedUserIds: [], blockedUsers: [] };
        }

        const blockedUsers = await User.find({ _id: { $in: blockedUserIds } })
                .select(BLOCKED_USER_PUBLIC_FIELDS)
                .lean();
        const blockedUserById = new Map(
                blockedUsers.map((blockedUser) => [toNormalizedId(blockedUser._id), blockedUser])
        );
        const orderedBlockedUsers = blockedUserIds
                .map((blockedUserId) => blockedUserById.get(blockedUserId))
                .filter(Boolean);

        return {
                blockedUserIds,
                blockedUsers: orderedBlockedUsers,
        };
};



//sign up new user
export const Signup = async (req, res) => {
        const { fullName, email, password, bio } = req.body;

        try {
                if (!fullName || !email || !password || !bio) {
                        return res.json({ success: false, message: "Missing Details" })
                }

                const user = await User.findOne({ email })

                if (user) {
                        return res.json({ success: false, message: "Account already exists" })
                }

                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt)

                const newUser = await User.create({
                        fullName, email, password: hashedPassword, bio
                })

                const token = generateToken(newUser._id)
                setAuthCookie(res, token);

                res.json({ success: true, userData: sanitizeUser(newUser), token, message: "Account created successfully" })

        } catch (error) {
                console.log(error.message);
                res.json({ success: false, message: error.message });
        }

}

//controller to login a user
export const login = async (req, res) => {
        try {
                const { email, password } = req.body;
                const userData = await User.findOne({ email })
                if (!userData) {
                        return res.json({ success: false, message: "User not found" });
                }
                const isPasswordCorrect = await bcrypt.compare(password, userData.password);
                if (!isPasswordCorrect) {
                        return res.json({ success: false, message: "Invalid credentials" })
                }

                if (userData.twoFactorEnabled) {
                        const twoFactorToken = createTwoFactorLoginToken(userData._id);
                        if (!twoFactorToken) {
                                return res.json({
                                        success: false,
                                        message: "Could not initialize two-factor challenge",
                                });
                        }
                        return res.json({
                                success: true,
                                requiresTwoFactor: true,
                                twoFactorToken,
                                message: "Two-factor authentication required",
                        });
                }

                const token = generateToken(userData._id)
                setAuthCookie(res, token);
                res.json({ success: true, userData: sanitizeUser(userData), token, message: "Login successful" })
        } catch (error) {
                console.log(error.message)
                res.json({ success: false, message: error.message })
        }
}

export const verifyTwoFactorLogin = async (req, res) => {
        try {
                const twoFactorToken = String(req.body?.twoFactorToken || "").trim();
                const normalizedCode = toNormalizedTotpCode(req.body?.code);

                if (!twoFactorToken || !isValidTotpCodeFormat(normalizedCode)) {
                        return res.json({
                                success: false,
                                message: "Invalid two-factor verification payload",
                        });
                }

                const userIdFromChallenge = verifyTwoFactorLoginToken(twoFactorToken);
                if (!userIdFromChallenge) {
                        return res.json({
                                success: false,
                                message: "Two-factor challenge expired. Please login again.",
                        });
                }

                const userData = await User.findById(userIdFromChallenge).select("+twoFactorSecret");
                if (!userData) {
                        return res.json({ success: false, message: "User not found" });
                }
                if (!userData.twoFactorEnabled || !userData.twoFactorSecret) {
                        return res.json({
                                success: false,
                                message: "Two-factor authentication is not enabled for this account",
                        });
                }

                const isCodeValid = await isTotpCodeValid({
                        token: normalizedCode,
                        secret: userData.twoFactorSecret,
                });
                if (!isCodeValid) {
                        return res.json({ success: false, message: "Invalid verification code" });
                }

                const token = generateToken(userData._id);
                setAuthCookie(res, token);
                return res.json({
                        success: true,
                        userData: sanitizeUser(userData),
                        token,
                        message: "Login successful",
                });
        } catch (error) {
                console.log(error.message);
                return res.json({ success: false, message: error.message });
        }
};

//controller to check if user is authenticated
export const checkAuth = (req, res) => {
        res.json({ success: true, user: sanitizeUser(req.user) });
}

export const logout = (req, res) => {
        clearAuthCookie(res);
        res.json({ success: true, message: "Logout successful" });
}

//controller to update user profile details
export const updateProfile = async (req, res) => {
        try {
                const { profilePic, bio, fullName } = req.body;
                const userId = req.user._id;
                const existingUser = await User.findById(userId).select(
                        "profilePic profilePicPublicId profilePicResourceType"
                );
                if (!existingUser) {
                        return res.json({ success: false, message: "User not found" });
                }

                let updatedUser;

                if (!profilePic){
                        updatedUser = await User.findByIdAndUpdate(userId , {bio , fullName},{new:true})
                }else{
                        const uploadedAvatar = await uploadBase64ToCloudinary(profilePic, {
                                folder: "quickchat/avatars",
                                resourceType: "image",
                        });
                        updatedUser = await User.findByIdAndUpdate(
                                userId,
                                {
                                        profilePic: uploadedAvatar.secureUrl,
                                        profilePicPublicId: uploadedAvatar.publicId,
                                        profilePicResourceType: uploadedAvatar.resourceType || "image",
                                        bio,
                                        fullName,
                                },
                                {new: true}
                        );

                        if (
                                existingUser.profilePicPublicId &&
                                existingUser.profilePicPublicId !== uploadedAvatar.publicId
                        ) {
                                const destroyResult = await destroyCloudinaryAsset({
                                        publicId: existingUser.profilePicPublicId,
                                        resourceType:
                                                existingUser.profilePicResourceType || "image",
                                });
                                if (!destroyResult.success && !destroyResult.skipped) {
                                        console.log(destroyResult.message);
                                }
                        }
                }


                res.json({success: true , user: sanitizeUser(updatedUser)})

        } catch (error) {
                console.log(error.message)
                res.json({success: false , message: error.message})
        }
}

export const beginTwoFactorSetup = async (req, res) => {
        try {
                const userId = toNormalizedId(req.user?._id);
                if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
                        return res.json({ success: false, message: "Invalid user id" });
                }

                const userData = await User.findById(userId).select("email twoFactorEnabled +twoFactorTempSecret");
                if (!userData) {
                        return res.json({ success: false, message: "User not found" });
                }

                const generatedSecret = generateTotpSecret();
                const otpauthUrl = generateTotpUri({
                        strategy: "totp",
                        issuer: TWO_FACTOR_ISSUER,
                        label: userData.email,
                        secret: generatedSecret,
                });

                let qrCodeDataUrl = "";
                try {
                        qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
                                width: 220,
                                margin: 1,
                        });
                } catch (qrCodeError) {
                        console.log(`2FA QR generation failed: ${qrCodeError?.message || qrCodeError}`);
                }

                userData.twoFactorTempSecret = generatedSecret;
                await userData.save();

                return res.json({
                        success: true,
                        message: userData.twoFactorEnabled
                                ? "Two-factor setup refreshed. Verify to rotate your authenticator key."
                                : "Two-factor setup started. Scan the QR code and verify your code.",
                        setup: {
                                issuer: TWO_FACTOR_ISSUER,
                                accountName: userData.email,
                                manualEntryKey: generatedSecret,
                                otpauthUrl,
                                qrCodeDataUrl,
                        },
                });
        } catch (error) {
                console.log(error.message);
                return res.json({ success: false, message: error.message });
        }
};

export const enableTwoFactor = async (req, res) => {
        try {
                const userId = toNormalizedId(req.user?._id);
                const normalizedCode = toNormalizedTotpCode(req.body?.code);
                if (!isValidTotpCodeFormat(normalizedCode)) {
                        return res.json({ success: false, message: "Invalid verification code" });
                }

                const userData = await User.findById(userId).select(
                        "twoFactorEnabled +twoFactorTempSecret +twoFactorSecret"
                );
                if (!userData) {
                        return res.json({ success: false, message: "User not found" });
                }
                if (!userData.twoFactorTempSecret) {
                        return res.json({
                                success: false,
                                message: "No two-factor setup is in progress",
                        });
                }

                const isCodeValid = await isTotpCodeValid({
                        token: normalizedCode,
                        secret: userData.twoFactorTempSecret,
                });
                if (!isCodeValid) {
                        return res.json({ success: false, message: "Invalid verification code" });
                }

                const wasEnabled = Boolean(userData.twoFactorEnabled);
                userData.twoFactorSecret = userData.twoFactorTempSecret;
                userData.twoFactorTempSecret = "";
                userData.twoFactorEnabled = true;
                userData.twoFactorEnabledAt = new Date();
                await userData.save();

                const refreshedUser = await User.findById(userId);
                return res.json({
                        success: true,
                        message: wasEnabled
                                ? "Two-factor authentication updated"
                                : "Two-factor authentication enabled",
                        user: sanitizeUser(refreshedUser),
                });
        } catch (error) {
                console.log(error.message);
                return res.json({ success: false, message: error.message });
        }
};

export const disableTwoFactor = async (req, res) => {
        try {
                const userId = toNormalizedId(req.user?._id);
                const normalizedCode = toNormalizedTotpCode(req.body?.code);
                if (!isValidTotpCodeFormat(normalizedCode)) {
                        return res.json({ success: false, message: "Invalid verification code" });
                }

                const userData = await User.findById(userId).select(
                        "twoFactorEnabled +twoFactorSecret +twoFactorTempSecret"
                );
                if (!userData) {
                        return res.json({ success: false, message: "User not found" });
                }
                if (!userData.twoFactorEnabled || !userData.twoFactorSecret) {
                        return res.json({
                                success: false,
                                message: "Two-factor authentication is not enabled",
                        });
                }

                const isCodeValid = await isTotpCodeValid({
                        token: normalizedCode,
                        secret: userData.twoFactorSecret,
                });
                if (!isCodeValid) {
                        return res.json({ success: false, message: "Invalid verification code" });
                }

                userData.twoFactorEnabled = false;
                userData.twoFactorSecret = "";
                userData.twoFactorTempSecret = "";
                userData.twoFactorEnabledAt = null;
                await userData.save();

                const refreshedUser = await User.findById(userId);
                return res.json({
                        success: true,
                        message: "Two-factor authentication disabled",
                        user: sanitizeUser(refreshedUser),
                });
        } catch (error) {
                console.log(error.message);
                return res.json({ success: false, message: error.message });
        }
};

export const blockUser = async (req, res) => {
        try {
                const currentUserId = toNormalizedId(req.user?._id);
                const targetUserId = toNormalizedId(req.params?.id || req.body?.userId);

                if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
                        return res.json({ success: false, message: "Invalid user id" });
                }
                if (targetUserId === currentUserId) {
                        return res.json({ success: false, message: "You cannot block yourself" });
                }

                const targetExists = await User.exists({ _id: targetUserId });
                if (!targetExists) {
                        return res.json({ success: false, message: "User not found" });
                }

                await User.updateOne(
                        { _id: currentUserId },
                        { $addToSet: { blockedUsers: targetUserId } }
                );

                const blockedPayload = await getBlockedUsersPayload(currentUserId);
                return res.json({
                        success: true,
                        message: "User blocked",
                        ...blockedPayload,
                });
        } catch (error) {
                console.log(error.message);
                return res.json({ success: false, message: error.message });
        }
};

export const unblockUser = async (req, res) => {
        try {
                const currentUserId = toNormalizedId(req.user?._id);
                const targetUserId = toNormalizedId(req.params?.id || req.body?.userId);

                if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
                        return res.json({ success: false, message: "Invalid user id" });
                }

                await User.updateOne(
                        { _id: currentUserId },
                        { $pull: { blockedUsers: targetUserId } }
                );

                const blockedPayload = await getBlockedUsersPayload(currentUserId);
                return res.json({
                        success: true,
                        message: "User unblocked",
                        ...blockedPayload,
                });
        } catch (error) {
                console.log(error.message);
                return res.json({ success: false, message: error.message });
        }
};

export const getBlockedUsers = async (req, res) => {
        try {
                const blockedPayload = await getBlockedUsersPayload(req.user?._id);
                return res.json({ success: true, ...blockedPayload });
        } catch (error) {
                console.log(error.message);
                return res.json({ success: false, message: error.message });
        }
};
